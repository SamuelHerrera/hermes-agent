/** Transport-neutral session handle. Credentials remain in the owning client. */
export async function openSession(client, { scope, reference, requestId, spawn }) {
  if (reference && reference.scope !== scope) throw Error('OWNER_MISMATCH');
  if (reference && reference.epoch !== client.epoch) throw Error('HOST_LOST');
  const created = reference || await client.request('create', { ...spawn, scope, requestId });
  const durable = { scope, epoch: created.epoch, terminalId: created.terminalId };
  let attached = await client.request('attach', durable);
  return {
    reference: durable,
    pid: attached.pid,
    snapshot: attached.snapshot,
    async checkpoint() {
      attached = await client.request('attach', durable);
      return attached.snapshot;
    },
    read: after => client.request('read', { ...durable, after }),
    input: data => client.request('input', { ...attached.identity, data }),
    resize: size => client.request('resize', { ...attached.identity, ...size }),
    detach: () => client.request('detach', attached.identity),
    terminate: () => client.request('terminate', durable),
  };
}
