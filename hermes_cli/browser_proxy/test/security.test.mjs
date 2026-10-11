import { test } from 'node:test'
import assert from 'node:assert/strict'

test('resolver rejects non-public IPs and pins checked addresses', async () => {
  const { TargetPolicy } = await import('../security.mjs')
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '2002:7f00:1::',
    '224.0.0.1'
  ]) {
    const policy = new TargetPolicy(['hermes.example'], async () => [{ address: ip }])
    await assert.rejects(policy.resolve('site.example', 443))
  }
  const policy = new TargetPolicy(['hermes.example'], async () => [{ address: '93.184.216.34' }])
  await assert.rejects(policy.resolve('hermes.example', 443))
  await assert.rejects(policy.resolve('HERMES.EXAMPLE.', 443))
  await assert.rejects(policy.resolve('admin.hermes.example', 443))
  await assert.rejects(policy.resolve('site.example', 9119))
  await assert.rejects(policy.resolve('127.0.0.1', 443))
  assert.equal(await policy.resolve('site.example', 443), '93.184.216.34')
})

test('mixed DNS, rebinding and public management aliases fail closed', async () => {
  const { TargetPolicy } = await import('../security.mjs')
  let answers = [{ address: '93.184.216.34' }]
  const policy = new TargetPolicy([], async () => answers)
  assert.equal(await policy.resolve('site.example', 443), '93.184.216.34')
  answers = [{ address: '10.0.0.1' }]
  await assert.rejects(policy.resolve('site.example', 443))
  answers = [{ address: '93.184.216.34' }, { address: '::1' }]
  await assert.rejects(policy.resolve('site.example', 443))
  answers = [{ address: '93.184.216.34' }]
  await policy.denyHost('hermes.example')
  await assert.rejects(policy.resolve('unrelated-public-alias.example', 443))
})
