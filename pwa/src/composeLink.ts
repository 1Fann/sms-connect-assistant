/** Keep the recipient in a fragment, outside HTTP requests and referrers. No credentials cross apps. */
export function messagesComposeLink(number:string,origin:string):string|undefined {
 if(!/^\+?\d{3,20}$/.test(number))return;
 const url=new URL(origin);url.protocol='https:';url.port='8443';url.pathname='/';url.search='';
 url.hash=new URLSearchParams({compose:number}).toString();
 return url.href;
}
export function composeRecipient(hash:string):string|null {
 const params=new URLSearchParams(hash.replace(/^#/,''));
 const value=params.get('compose');
 return !params.has('conversation')&&value&&/^\+?\d{3,20}$/.test(value)?value:null;
}
