const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

function load (Bot = { uin: 123, nickname: 'single' }) {
  const writes = []
  const context = vm.createContext({
    Bot,
    plugin: class {},
    createRequire: () => () => ({ exec () {}, execSync () {} }),
    lodash: {}, fs: { readdirSync: () => [] }, common: {},
    setting: { getConfig: () => ({ log: 2 }) }, PluginsLoader: {},
    logger: { info () {}, error () {} },
    redis: { set: (...args) => writes.push(args) },
    setTimeout () {}
  })
  vm.runInContext(fs.readFileSync(path.join(root, 'model/groupBot.js'), 'utf8')
    .replace(/^export /gm, ''), context)
  vm.runInContext(fs.readFileSync(path.join(root, 'app/autoUpdate.js'), 'utf8')
    .replace(/^import .*;?\r?\n/gm, '')
    .replace('import.meta.url', JSON.stringify(path.join(root, 'app/autoUpdate.js')))
    .replace('export class autoUpdate', 'class autoUpdate') + '\nglobalThis.Update = autoUpdate', context)
  return { context, instance: new context.Update(), writes }
}

for (const [versions, expected] of [
  [{ yarn: true, pnpm: true }, 'yarn'],
  [{ yarn: false, pnpm: true }, 'pnpm'],
  [{ yarn: false, pnpm: false }, 'npm']
]) {
  test(`package manager selection: ${expected}`, async () => {
    const { instance } = load()
    const calls = []
    instance.execSync = async command => {
      calls.push(command)
      return { stdout: versions[command.split(' ')[0]] ? '1.0.0' : '' }
    }
    assert.equal(await instance.checkPackageManager(), expected)
    assert.deepEqual(calls, expected === 'yarn' ? ['yarn -v'] : ['yarn -v', 'pnpm -v'])
  })
}

test('multi-bot update log key uses the same deterministic ID as its reader', async () => {
  const { instance, context, writes } = load({
    uin: ['ko_other', 123], nickname: 'fallback',
    bots: { 123: { nickname: 'QQ' } }
  })
  instance.runUpdate = async () => true
  instance.saveLog = async () => {}
  await instance.updateAll()
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], 'Yz:auto-plugin:Update:123')
  assert.equal(writes[0][0], `Yz:auto-plugin:Update:${vm.runInContext('getMainBot().uin', context)}`)
  assert.equal(writes[0][2].EX, 72000)
})

test('single-bot key stays compatible', async () => {
  const { instance, writes } = load()
  instance.runUpdate = async () => true
  instance.saveLog = async () => {}
  await instance.updateAll()
  assert.equal(writes[0][0], 'Yz:auto-plugin:Update:123')
})

test('group operations use the group owner bot rather than the first online bot', () => {
  const { context } = load({ uin: [123, 'ko_other'], nickname: 'fallback',
    gl: new Map([[456, { bot_id: 'ko_other' }]]),
    bots: { ko_other: { nickname: 'KOOK' } } })
  const owner = vm.runInContext('getGroupBot(456)', context)
  assert.equal(owner.uin, 'ko_other')
  assert.equal(owner.nickname, 'KOOK')
})
