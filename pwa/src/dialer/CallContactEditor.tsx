import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal, flushSync} from 'react-dom';
import {api, err, PhoneError, type Contact, type Device} from './client';
import {PhoneAvatar, PhoneIcon} from './PhoneIcon';
import {formatPhone, identity} from '../phone';
import {sectionContacts} from './contactSections';
import {primarySource, createAndroidContact, editAndroidContact, appendAndroidNumber, checkAndroidWrite, type AndroidWrite} from './androidContacts';
import {PhoneNumberPad} from './PhoneNumberPad';
import './contact-editor.css';

type EditorMode = 'create' | 'choose' | 'edit';
type Props = {
  number?: string;
  mode: EditorMode;
  contact?: Contact;
  devices: Device[];
  onClose: () => void;
  onSaved: (name: string) => void;
};
type PhoneDraft = {id: number, value: string};

export function CallContactEditor({number = '', mode, contact, devices, onClose, onSaved}: Props) {
  const initialSource = contact ? primarySource(contact) : undefined;
  const [step, setStep] = useState<EditorMode | 'append'>(mode);
  const [name, setName] = useState(initialSource?.name || '');
  const serial = useRef(0);
  function draftNumbers(values: string[]): PhoneDraft[] {
    return values.map(value => ({id: ++serial.current, value}));
  }
  const [phones, setPhones] = useState(() => draftNumbers(initialSource?.numbers || (number ? [number] : [])));
  const [padRow,setPadRow]=useState<number|null>(null);
  const [removeId, setRemoveId] = useState<number | null>(null);
  const [raw, setRaw] = useState(initialSource?.rawId || '');
  const writableDevices = devices.filter(device => device.contactsWrite === true);
  const [device, setDevice] = useState(() => writableDevices.length === 1 ? writableDevices[0].deviceId : '');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Contact[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Contact | null>(contact || null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const active = useRef(true);
  const lock = useRef(false);
  const intent = useRef<{key: string, id: string} | null>(null);
  const pending = useRef<AndroidWrite | null>(null);
  const source = selected?.sources.find(item => item.rawId === raw);
  const canWriteSource = !!source && !source.readOnly && writableDevices.some(item => item.deviceId === source.deviceId);
  const duplicate = selected?.numbers.some(phone => identity(phone) === identity(number)) === true;
  const full = !!source && source.numbers.length >= 32;
  const values = phones.map(row => row.value.trim()).filter(Boolean);
  const originalNumbers = (source?.numbers || []).map(value => value.trim()).filter(Boolean);
  const nameChanged = name.trim() !== (source?.name || '').trim();
  const numbersChanged = values.length !== originalNumbers.length || values.some((value, index) => value !== originalNumbers[index]);
  const dirty = nameChanged || numbersChanged;
  const hasValue = Boolean(name.trim() || values.length);
  const valid = step === 'create' ? writableDevices.some(item => item.deviceId === device) && hasValue :
    step === 'edit' ? canWriteSource && hasValue && dirty : step === 'append' && canWriteSource && !duplicate && !full;
  const nameToWrite = step === 'create' || (step === 'edit' && nameChanged);
  const numbersToWrite = step === 'append' ? [number] : step === 'create' || numbersChanged ? values : [];
  const validData = (!nameToWrite || name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name)) &&
    numbersToWrite.length <= 32 && numbersToWrite.every(value => value.length <= 96 && !/[\u0000-\u001f\u007f]/.test(value));
  const editPage = mode === 'edit';
  const frozen = busy || submitted;
  const sheet = !editPage;
  const form = step === 'create' || step === 'edit';
  const portal = editPage ? document.getElementById('root') || document.body : document.body;

  useLayoutEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    const selector = editPage ? '#phone-app,.contact-sheet' : '#root,.contact-sheet';
    const background = [...document.querySelectorAll<HTMLElement>(selector)].filter(element => !element.inert);
    background.forEach(element => {element.inert = true});
    const focus = dialog.current?.querySelector<HTMLElement>(mode === 'create' ? '[data-editor-name]' : 'header button');
    focus?.focus({preventScroll: true});
    return () => {
      active.current = false;
      background.forEach(element => {element.inert = false});
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll: true});
    };
  }, [editPage, mode]);

  useLayoutEffect(() => {
    const panel=dialog.current?.querySelector<HTMLElement>('.ios-editor-scroll');
    if(!panel)return;
    let frame=0;
    function revealField() {
      frame=0;
      const field=document.activeElement;
      if(!panel || !(field instanceof HTMLInputElement) || !panel.contains(field))return;
      const bounds=panel.getBoundingClientRect();
      const row=field.getBoundingClientRect();
      // On iOS a focus change can pan a short form before the keyboard has its final height.
      // Scroll only this panel, keeping the avatar when both it and the field fit.
      if(panel.querySelectorAll('[data-phone-id]').length<=2 && row.bottom-bounds.top+panel.scrollTop+8<=bounds.height) {
        panel.scrollTop=0;
      } else if(row.bottom>bounds.bottom-8) {
        panel.scrollTop+=row.bottom-bounds.bottom+8;
      } else if(row.top<bounds.top+8) {
        panel.scrollTop+=row.top-bounds.top-8;
      }
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(revealField)};
    const resize=new ResizeObserver(schedule);
    resize.observe(panel);
    panel.addEventListener('focusin',schedule);
    const viewport=window.visualViewport;
    viewport?.addEventListener('resize',schedule);
    viewport?.addEventListener('scroll',schedule);
    schedule();
    return ()=>{
      cancelAnimationFrame(frame);resize.disconnect();
      panel.removeEventListener('focusin',schedule);
      viewport?.removeEventListener('resize',schedule);
      viewport?.removeEventListener('scroll',schedule);
    };
  },[step]);

  useEffect(() => {
    if (!editPage) return;
    function leaveViaDock(event: MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('.phone-dock')) return;
      if (lock.current || submitted || (dirty && !window.confirm('放弃对此联系人的更改？'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      onClose();
    }
    document.addEventListener('click', leaveViaDock, true);
    return () => document.removeEventListener('click', leaveViaDock, true);
  }, [editPage, dirty, submitted, onClose]);

  useEffect(() => {
    if (step !== 'choose') return;
    let alive = true;
    setLoading(true);
    if (offset === 0) setRows([]);
    const timer = setTimeout(() => {
      api<{items: Contact[], next: number | null}>('contacts?q=' + encodeURIComponent(query) + '&offset=' + offset)
        .then(page => {
          if (!alive) return;
          setRows(previous => offset ? [...previous, ...page.items] : page.items);
          setNext(page.next);
          setError('');
        })
        .catch(reason => {if (alive) setError(err(reason))})
        .finally(() => {if (alive) setLoading(false)});
    }, 180);
    return () => {alive = false; clearTimeout(timer)};
  }, [step, query, offset]);

  function sourceChange(value: string, card = selected) {
    const chosen = card?.sources.find(item => item.rawId === value);
    setPadRow(null);
    setRaw(value);
    setName(chosen?.name || '');
    setPhones(draftNumbers(chosen?.numbers || []));
    setRemoveId(null);
  }
  function choose(card: Contact) {
    setSelected(card);
    sourceChange(primarySource(card)?.rawId || '', card);
    setStep('append');
    setError('');
  }
  function back() {
    if (lock.current) return;
    if (step === 'append' && !submitted) {
      setOffset(0); setRows([]); setNext(null); setStep('choose'); setError(''); setSelected(null);
    } else onClose();
  }
  function addPhone() {
    if (frozen || phones.length >= 32) return;
    const id = ++serial.current;
    // Focus while the add gesture is active so iOS presents its telephone keyboard.
    flushSync(() => {
      setRemoveId(null);
      setPhones(previous => [...previous, {id, value: ''}]);
    });
    dialog.current?.querySelector<HTMLInputElement>('[data-phone-id="' + id + '"]')?.focus();
  }
  function updatePhone(id:number,value:string) {
    setPhones(previous=>previous.map(row=>row.id===id?{...row,value}:row));
  }
  function padInput() {
    return padRow===null?null:dialog.current?.querySelector<HTMLInputElement>('[data-phone-id="'+padRow+'"]');
  }
  function typeOnPad(insert:string) {
    const input=padInput();
    if(!input||padRow===null||frozen)return;
    const end=input.selectionEnd??input.value.length;
    let start=input.selectionStart??end;
    if(insert===''&&start===end)start=Math.max(0,start-1);
    const value=input.value.slice(0,start)+insert+input.value.slice(end);
    if(value.length>input.maxLength)return;
    flushSync(()=>updatePhone(padRow,value));
    input.setSelectionRange(start+insert.length,start+insert.length);
  }
  function dismissPad() {
    padInput()?.blur();
    setPadRow(null);
  }
  async function save() {
    if (lock.current || (!submitted && (!valid || !validData)) || step === 'choose') return;
    setPadRow(null);
    lock.current = true; setBusy(true); setError(''); setStatus('');
    try {
      if (!pending.current) {
        const action = step === 'create' ? 'create' : 'edit';
        const changed: {name?: string, numbers?: string[]} = {};
        if (nameChanged) changed.name = name.trim();
        if (numbersChanged) changed.numbers = values;
        const body = step === 'create' ? createAndroidContact(device, name, values) :
          step === 'append' ? appendAndroidNumber(selected!, source!, number) : editAndroidContact(selected!, source!, changed);
        const key = JSON.stringify([action, body]);
        if (intent.current?.key !== key) intent.current = {key, id: crypto.randomUUID()};
        setSubmitted(true);
        pending.current = await api<AndroidWrite>('contacts/native/' + action, {...body, requestId: intent.current.id});
      }
      const done = await checkAndroidWrite(pending.current, () => active.current, message => {if (active.current) setStatus(message)});
      if (active.current) {
        if (done) onSaved(form ? name.trim() : selected!.name);
        else setStatus('已排队，等待安卓手机写入。可点「检查进度」继续查看。');
      }
    } catch (reason) {
      if (active.current) {
        if (reason instanceof PhoneError && [400, 403, 404, 409, 410].includes(reason.status) && !pending.current) {
          setSubmitted(false); intent.current = null;
        }
        setError(err(reason) + (pending.current ? '。请返回后核对安卓联系人和授权。' : '。可重试；联系人已改变时请先重新读取。'));
      }
    } finally {lock.current = false; if (active.current) setBusy(false)}
  }
  async function reread() {
    if (!selected || busy || pending.current) return;
    try {
      const fresh = await api<Contact>('contacts/' + encodeURIComponent(selected.id));
      if (!active.current) return;
      setSelected(fresh);
      sourceChange(primarySource(fresh)?.rawId || '', fresh);
      intent.current = null; setSubmitted(false); setError(''); setStatus('已读取安卓联系人，请核对后保存。');
    } catch (reason) {if (active.current) setError(err(reason))}
  }
  const title = {create: '新建联系人', edit: '编辑联系人', choose: '添加到现有联系人', append: '添加电话号码'}[step];
  const backLabel = step === 'append' || submitted ? '返回' : '取消';
  const saveLabel = busy ? '保存中…' : pending.current ? '检查进度' : submitted ? '重试' : '完成';
  const targetName = devices.find(item => item.deviceId === selected?.deviceId)?.name || '安卓通讯录';
  const currentTarget = writableDevices.find(item => item.deviceId === device);
  const groups = step === 'choose' ? sectionContacts(rows) : [];
  return createPortal(<>
    {sheet && <div className="ios-editor-backdrop" aria-hidden="true" />}
    <section ref={dialog} className={'call-contact-editor ios-editor ' + (sheet ? 'ios-editor-sheet' : 'ios-editor-edit')}
      data-phone-pad={padRow!==null&&!frozen?'true':undefined}
      onFocusCapture={event=>{
        if(!(event.target as HTMLElement).closest('[data-phone-id],.phone-number-pad'))setPadRow(null);
      }}
      role="dialog" aria-modal={sheet} aria-label={title} onKeyDown={event => {
        if(event.key==='Escape'&&padRow!==null){event.preventDefault();dismissPad();return}
        if (event.key === 'Escape') {event.preventDefault(); back(); return}
        if (!sheet || event.key !== 'Tab') return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
        if (event.shiftKey && document.activeElement === items[0]) {event.preventDefault(); items.at(-1)?.focus()}
        else if (!event.shiftKey && document.activeElement === items.at(-1)) {event.preventDefault(); items[0]?.focus()}
      }}>
      {sheet && <span aria-hidden="true" className="ios-editor-grabber" />}
      <header className="ios-editor-toolbar">
        <button className="ios-editor-circle" aria-label={backLabel} disabled={busy} onClick={back}>
          <PhoneIcon name={step === 'append' && !submitted ? 'back' : 'close'} size={23} />
        </button>
        <h1 className={editPage ? 'sr-only' : undefined}>{title}</h1>
        {step !== 'choose' && <button className={'ios-editor-circle ios-editor-save' + (submitted ? ' is-submitted' : '')}
          aria-label={saveLabel} disabled={busy || !submitted && (!valid || !validData)} onClick={() => void save()}>
          {submitted ? saveLabel : <PhoneIcon name="check" size={23} />}
        </button>}
      </header>
      <div key={step} className="ios-editor-scroll">
        {step === 'choose' ? <>
          <label className="ios-picker-search">
            <PhoneIcon name="search" size={18} />
            <input type="search" aria-label="搜索现有联系人" placeholder="搜索" value={query} onChange={event => {
              setQuery(event.target.value); setOffset(0);
            }}/>
          </label>
          <p className="ios-editor-caption">选择联系人以添加 {formatPhone(number)}</p>
          {groups.map(([letter, contacts]) => <section className="ios-picker-group" key={letter}>
            <h2>{letter}</h2>
            {contacts.map(card => <button className="ios-picker-contact" key={card.id} disabled={loading} onClick={() => choose(card)}>
              <PhoneAvatar photo={card.photo} />
              <span><strong>{card.name || '未命名'}</strong><small>{card.numbers.map(value => formatPhone(value)).join('、')}</small></span>
            </button>)}
          </section>)}
          {!rows.length && !loading && <p className="ios-editor-caption">没有匹配的安卓联系人</p>}
          {loading && <p className="ios-editor-caption" role="status">正在读取联系人…</p>}
          {next !== null && <button disabled={loading} className="load-more" onClick={() => setOffset(next)}>载入更多</button>}
        </> : <>
          <div className="ios-editor-identity">
            <PhoneAvatar poster photo={selected?.photo} />
            {step === 'create' ? <label className="ios-editor-destination">
              <span aria-hidden="true">{currentTarget ? '保存到 ' + currentTarget.name : '选择安卓手机'}</span>
              <span className="ios-editor-chevron" aria-hidden="true">⌄</span>
              <select aria-label="保存到安卓手机" disabled={frozen} value={device} onChange={event => setDevice(event.target.value)}>
                <option value="">选择手机</option>
                {writableDevices.map(item => <option key={item.deviceId} value={item.deviceId}>{item.name}{item.online ? '' : '（离线，等待连接）'}</option>)}
              </select>
            </label> : <span className="ios-editor-origin">{targetName}</span>}
          </div>
          {selected && selected.sources.length > 1 && <label className="ios-editor-group ios-editor-source">
            <span>保存位置</span>
            <select aria-label="联系人保存位置" disabled={frozen} value={raw} onChange={event => sourceChange(event.target.value)}>
              {selected.sources.map(item => <option key={item.rawId} value={item.rawId} disabled={item.readOnly}>{item.name || '未命名'} · {item.readOnly ? '只读' : '可编辑'}</option>)}
            </select>
          </label>}
          {form ? <>
            <label className="ios-editor-group ios-editor-name">
              <span>姓名</span>
              <input aria-label="姓名" data-editor-name maxLength={200} autoComplete="off" placeholder="姓名"
                readOnly={frozen} value={name} onChange={event => setName(event.target.value)} />
            </label>
            <section className="ios-editor-group ios-editor-phones" aria-label="电话号码">
              {phones.map(({id, value}, index) => <div className="ios-phone-row" key={id}>
                <button className="ios-phone-remove" aria-label={'移除第 ' + (index + 1) + ' 个电话号码'} disabled={frozen}
                  aria-expanded={removeId === id} onClick={() => setRemoveId(removeId === id ? null : id)}><span aria-hidden="true">−</span></button>
                <span className="ios-phone-label">电话</span>
                <input type="text" inputMode="none" aria-label={index ? '联系人电话号码 ' + (index + 1) : '联系人电话号码'} data-phone-id={id}
                  autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  placeholder="电话号码" maxLength={96} readOnly={frozen} value={value}
                  onFocus={()=>{if(!frozen)setPadRow(id);setRemoveId(null)}} onClick={()=>{if(!frozen)setPadRow(id)}}
                  onKeyDown={event=>{if(event.key==='Enter'&&padRow===id){event.preventDefault();dismissPad()}}}
                  onChange={event=>updatePhone(id,event.target.value)} />
                {removeId === id && <button className="ios-phone-delete" disabled={frozen} onClick={() => {
                  if(padRow===id)setPadRow(null);
                  setPhones(previous => previous.filter(row => row.id !== id)); setRemoveId(null);
                }}>删除</button>}
              </div>)}
              <button className="ios-phone-add" disabled={frozen || phones.length >= 32} onClick={addPhone}>
                <span aria-hidden="true">+</span>添加电话
              </button>
            </section>
          </> : <>
            <section className="ios-editor-group ios-append-fields"><h2>{selected?.name || '未命名'}</h2>
              {selected?.numbers.map(value => <p key={value}>{formatPhone(value)}</p>)}
            </section>
            <div className="ios-editor-group ios-append-number"><span>添加电话</span><strong>{formatPhone(number)}</strong></div>
            {duplicate && <p className="ios-editor-caption" role="status">此联系人已包含该号码</p>}
            {full && <p role="alert">所选来源已有 32 个号码，请先整理。</p>}
          </>}
          <p className="ios-editor-caption">{step === 'create' ? '保存到所选安卓手机的系统通讯录。' : '保存后会修改安卓手机系统通讯录。'}</p>
          {(step === 'create' ? !writableDevices.length : !canWriteSource) && <p role="alert">请在目标安卓手机开启「通讯数据授权 → 允许远程编辑通讯录」。只读账号无法修改。</p>}
          {submitted && <p className="ios-editor-caption">已提交或正在确认结果，关闭页面不会撤回已提交的任务。</p>}
          {error && selected && !pending.current && <button className="ios-editor-reload" disabled={busy} onClick={() => void reread()}>重新读取联系人</button>}
        </>}
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {padRow!==null&&!frozen&&form&&<PhoneNumberPad onInsert={typeOnPad} onDelete={()=>typeOnPad('')} onDismiss={dismissPad}/>}
    </section>
  </>, portal);
}
