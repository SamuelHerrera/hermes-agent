import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function connect(directory) {
  const endpoint = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8'));
  return {
    epoch: endpoint.epoch,
    async request(method, params = {}) {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/rpc`, {
        method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method, params, epoch: endpoint.epoch }), signal: AbortSignal.timeout(10000),
      });
      const value = await response.json();
      if (!response.ok || value.error) throw Object.assign(new Error(value.error || 'REQUEST_FAILED'), { code: value.error });
      return value.result;
    },
  };
}
