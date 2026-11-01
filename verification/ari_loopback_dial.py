"""Real ARI create/dial regression against a loopback-only synthetic SIP endpoint.
Run inside the existing PBX as root. Never targets a registered phone or cellular gateway.
Credentials stay on the PBX; output contains only statuses and boolean assertions.
"""
import argparse,base64,hashlib,json,os,re,socket,struct,subprocess,threading,time,uuid
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler
from urllib.parse import urlencode
from urllib.error import HTTPError

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--credentials-file',required=True)
 p.add_argument('--expect-no-invite',action='store_true')
 args=p.parse_args()
 keys=json.loads(Path(args.credentials_file).read_text())
 token=base64.b64encode((keys['ariUser']+':'+keys['ariPassword']).encode()).decode()
 port=int(keys.get('port',8088));opener=build_opener(ProxyHandler({}))
 def api(method,path,query=None):
  req=Request('http://127.0.0.1:'+str(port)+'/ari/'+path+('?' +urlencode(query) if query else ''),
   method=method,data=b'' if method=='POST' else None,
   headers={'Authorization':'Basic '+token,'Content-Type':'application/json'})
  try:
   with opener.open(req,timeout=4) as r:return r.status,r.read()
  except HTTPError as e:return e.code,e.read()
 status,channels=api('GET','channels')
 assert status==200 and json.loads(channels)==[],'PBX has active channels; test not started'
 overlay=Path('/etc/asterisk/commlink-pjsip.conf')
 assert overlay.is_file(),'CommLink overlay not found'
 before=overlay.read_bytes();metadata=overlay.stat()
 def replace(data):
  tmp=overlay.with_suffix('.dialcheck.tmp')
  tmp.write_bytes(data);os.chmod(tmp,metadata.st_mode&0o777);os.chown(tmp,metadata.st_uid,metadata.st_gid)
  os.replace(tmp,overlay)
 def reload():
  result=subprocess.run(['/usr/sbin/asterisk','-rx','module reload res_pjsip.so'],capture_output=True)
  assert result.returncode==0,'Endpoint reload failed'
 udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);udp.bind(('127.0.0.1',0));udp.settimeout(3)
 endpoint='cl-check-'+uuid.uuid4().hex[:12];channel=endpoint+'-leg';application=endpoint+'-app'
 config=before+b'\n'+(
  '['+endpoint+']\ntype=aor\ncontact=sip:'+endpoint+'@127.0.0.1:'+str(udp.getsockname()[1])+'\n'
  '['+endpoint+']\ntype=endpoint\ntransport=transport-loopback\ncontext=cl-native-in\n'
  'aors='+endpoint+'\ndisallow=all\nallow=ulaw,alaw\ndirect_media=no\nallow_transfer=no\n'
 ).encode()
 ws=None;changed=False;created=False;stop=threading.Event();joined=threading.Event();terminated=threading.Event()
 def send_frame(op,payload):
  mask=os.urandom(4);n=len(payload)
  lead=bytes([128|op,128+n]) if n<126 else bytes([128|op,254])+struct.pack('!H',n)
  ws.sendall(lead+mask+bytes(c^mask[i%4] for i,c in enumerate(payload)))
 def take(n):
  out=b''
  while len(out)<n:
   chunk=ws.recv(n-len(out))
   if not chunk:raise EOFError()
   out+=chunk
  return out
 def read_events():
  try:
   while not stop.is_set():
    first=take(2);n=first[1]&127;opcode=first[0]&15
    if n==126:n=struct.unpack('!H',take(2))[0]
    elif n==127:n=struct.unpack('!Q',take(8))[0]
    assert n<=262144
    mask=take(4) if first[1]&128 else None
    payload=take(n)
    if mask:payload=bytes(c^mask[i%4] for i,c in enumerate(payload))
    if opcode==9:send_frame(10,payload);continue
    if opcode==8:return
    if opcode!=1:continue
    event=json.loads(payload)
    if event.get('channel',{}).get('id')==channel:
     if event.get('type')=='StasisStart':joined.set()
     if event.get('type') in ['StasisEnd','ChannelDestroyed']:terminated.set()
  except (OSError,EOFError):pass
 try:
  ws=socket.create_connection(('127.0.0.1',port),timeout=5);ws.settimeout(10)
  key=base64.b64encode(os.urandom(16)).decode()
  ws.sendall(('GET /ari/events?app='+application+' HTTP/1.1\r\nHost: 127.0.0.1:'+str(port)+'\r\n'
   'Authorization: Basic '+token+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
   'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+'\r\n\r\n').encode())
  header=b''
  while not header.endswith(b'\r\n\r\n'):
   header+=take(1)
   assert len(header)<16384
  assert header.startswith(b'HTTP/1.1 101'),'ARI event upgrade failed'
  thread=threading.Thread(target=read_events,daemon=True);thread.start()
  replace(config);changed=True;reload()
  code,_=api('POST','channels/create',{'channelId':channel,'endpoint':'PJSIP/'+endpoint,'app':application,'appArgs':'diagnostic'})
  assert code==200,'Synthetic channel create failed: HTTP '+str(code)
  created=True;assert joined.wait(4),'Synthetic StasisStart missing'
  for name,value in [('PJSIP_HEADER(add,X-VSA-Dial)','5550100'),('PJSIP_HEADER(add,X-VSA-SIM)','2')]:
   code,_=api('POST','channels/'+channel+'/variable',{'variable':name,'value':value})
   assert code==204,'Synthetic header setting failed: HTTP '+str(code)
  code,_=api('POST','channels/'+channel+'/dial',{'timeout':'3'})
  assert code==204,'Synthetic dial API rejected: HTTP '+str(code)
  observed=False;headers_ok=False
  try:
   packet,source=udp.recvfrom(65536)
   assert source[0]=='127.0.0.1','Non-loopback SIP traffic'
   text=packet.decode()
   observed=text.startswith('INVITE sip:'+endpoint+'@127.0.0.1:')
   headers_ok=bool(re.search(r'(?im)^X-VSA-Dial:\s*5550100\s*$',text) and re.search(r'(?im)^X-VSA-SIM:\s*2\s*$',text))
   if observed:
    # A synthetic busy response ends the local transaction without any phone/carrier.
    def get(h):return re.search(r'(?im)^'+re.escape(h)+r':\s*([^\r\n]+)',text).group(1)
    response='SIP/2.0 486 Busy Here\r\n'
    for h in ['Via','From','To','Call-ID','CSeq']:
     value=get(h)
     if h=='To' and ';tag=' not in value:value+=';tag=loopback-diagnostic'
     response+=h+': '+value+'\r\n'
    udp.sendto((response+'Content-Length: 0\r\n\r\n').encode(),source)
  except socket.timeout:pass
  print('ARI dial HTTP accepted: true')
  print('Loopback SIP INVITE observed:',observed)
  print('Destination and SIM headers correct:',headers_ok)
  if args.expect_no_invite:assert not observed,'Unexpected INVITE before repair'
  else:assert observed and headers_ok,'ARI accepted dial but loopback INVITE did not arrive correctly'
 finally:
  if created:
   code,_=api('DELETE','channels/'+channel);assert code in [204,404],'Synthetic channel cleanup failed'
  if changed:replace(before);reload()
  stop.set()
  if ws:ws.close()
  udp.close()
  code,remaining=api('GET','channels')
  assert code==200 and all(x['id']!=channel for x in json.loads(remaining)),'Synthetic channel still active'
  print('Temporary endpoint, channel and event connection cleaned up')
if __name__=='__main__':main()
