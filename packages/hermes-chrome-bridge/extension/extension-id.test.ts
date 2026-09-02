import { describe, expect, it } from 'vitest'

import { deriveExtensionId } from './extension-id.js'

const PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxc/nMs86odPyWhOja1x0r1mnBtOXPa+As2Blon3AqCrhGHgu7xKDcivQGeG1Eu6LrSbYPrhpdOFeNNeIZni7R5dUtB2eO7V7WTgdWpig1Oh81EDLqsITNuWm85v8zok0Vpe9SazREt9rz9lhDNwxADjHgS1SoOjREvij89jx8CbE73OJKH2X88fvZhXT9r67jodRDsvTDM5+RbhXTi6D44Ihv0Ppe+ci2BQDu+BDhklDLQ1vcUPVXmnIzb6whXKzm1eviFjqDkMLIJT+6Vy97RNaOdPF02IjhCegBln+jccqeGYz8s3QlGK0p6VZ9AkR6Hd+FUVZLxGDUgrpSCTVQwIDAQAB'

describe('stable unpacked extension ID', () => {
  it('derives Chrome\'s stable ID from the committed public manifest key', async () => {
    await expect(deriveExtensionId(PUBLIC_KEY)).resolves.toBe(
      'mdeahbanbmncnmkjkklglmdflkcclckg'
    )
  })

  it('rejects malformed public keys', async () => {
    await expect(deriveExtensionId('not base64!')).rejects.toThrow('valid base64')
  })
})
