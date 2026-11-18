/** Upgrade an existing subscription only. Never prompt, subscribe, or change preview consent. */
export async function refreshPushKeys(send:(body:unknown)=>Promise<unknown>){
 if(!('serviceWorker' in navigator)||!('Notification' in globalThis)||Notification.permission!=='granted')return;
 try{
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  if(!subscription)return;
  const keys=subscription.toJSON().keys;
  if(!keys?.p256dh||!keys.auth)return;
  await send({endpoint:subscription.endpoint,...keys});
 }catch{/* Existing subscriptions still work; retry on the next app launch. */}
}
