// Exercise the shipped service worker without contacting a subscription or SMS service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handlers = {};
let notification, opened;
const self = {
  location: {origin: 'https://sms.example.com'},
  registration: {async showNotification(title, options) { notification = {title, ...options}; }},
  addEventListener(name, handler) { handlers[name] = handler; }
};
const clients = {async matchAll() { return []; }, async openWindow(url) { opened = url; }};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/sw.js'), 'utf8'), {self, clients, URL});
async function dispatch(type, event) {
  let pending;
  handlers[type]({...event, waitUntil(value) { pending = value; }});
  await pending;
}
(async () => {
  for (const data of [null, {json() { throw Error(); }}]) {
    await dispatch('push', {data});
    assert.equal(notification.body, '收到一条新短信');
    assert.equal(notification.data.address, '');
  }
  const message = {title: '测试联系人', body: '测试摘要', address: '+15550101234'};
  await dispatch('push', {data: {json() { return message; }}});
  assert.equal(notification.title, message.title);
  assert.equal(notification.body, message.body);
  const click = {notification: {...notification, close() {}}};
  await dispatch('notificationclick', click);
  assert.equal(opened, '/#conversation=%2B15550101234');
  let focused = false;
  clients.matchAll = async () => [{url: self.location.origin + '/', async navigate(url) {
    assert.equal(url, self.location.origin + opened);
    return {async focus() { focused = true; }};
  }}];
  await dispatch('notificationclick', click);
  assert.ok(focused);
  console.log('PASS generic, malformed, encrypted preview display, cold and warm click routing');
})().catch(error => { console.error(error); process.exitCode = 1; });
