// Exercise the shipped service worker without contacting a subscription or SMS service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handlers = {};
let notification, opened, badgeCalls = 0, iconBadge = 7;
const badgeValues = [];
const self = {
  location: {origin: 'https://sms.example.com'},
  // Model iOS: an unnumbered flag can clear a previously displayed count.
  navigator: {async setAppBadge(count) { badgeCalls++; badgeValues.push(count); iconBadge = count ?? 0; }},
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
    assert.equal(iconBadge, 1, 'closed iOS app retains a numeric unread indicator');
  }
  assert.equal(badgeCalls, 2, 'generic SMS push sets a badge while the app is closed');
  await dispatch('push', {data: {json() { return {title: '短信互联助手', body: '这是短信预览测试', badge: false}; }}});
  assert.equal(badgeCalls, 2, 'preview test does not set an unread badge');
  assert.equal(iconBadge, 1, 'preview test preserves the existing unread indicator');
  const message = {title: '测试联系人', body: '测试摘要', address: '+15550101234'};
  await dispatch('push', {data: {json() { return message; }}});
  assert.equal(badgeCalls, 3);
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
  assert.deepEqual(badgeValues, [1, 1, 1], 'no push requests an unsupported unnumbered iOS badge');
  self.navigator.setAppBadge = async () => { throw Error('Badging unavailable'); };
  await dispatch('push', {data: {json() { return message; }}});
  assert.equal(notification.body, message.body, 'badge failure does not suppress the notification');
  delete self.navigator.setAppBadge;
  await dispatch('push', {data: null});
  assert.equal(notification.body, '收到一条新短信');
  console.log('PASS numeric iOS badge, preserved preview-test badge, unavailable badging, preview display and click routing');
})().catch(error => { console.error(error); process.exitCode = 1; });
