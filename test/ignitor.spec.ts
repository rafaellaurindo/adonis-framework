/*
* @adonisjs/core
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import { join } from 'path'
import * as test from 'japa'
import { createServer } from 'http'
import { Filesystem } from '@adonisjs/dev-utils'
import * as supertest from 'supertest'
import { Ignitor } from '../src/Ignitor'

const fs = new Filesystem(join(__dirname, '__app'))

test.group('Ignitor', (group) => {
  group.before(() => {
    process.env.ENV_SILENT = 'true'
  })

  group.after(async () => {
    await fs.cleanup()
    delete process.env.ENV_SILENT
  })

  group.afterEach(async () => {
    await fs.cleanup()
  })

  test('setup application', async (assert) => {
    const ignitor = new Ignitor(fs.basePath)
    assert.exists(ignitor.application.version)
    assert.equal(ignitor.application.appName, 'adonis-app')
  })

  test('register and boot providers', async (assert) => {
    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add(`config/app.ts`, `
      const Env = global['use']('Adonis/Src/Env')
      export const appKey = Env.get('APP_KEY')
    `)

    await fs.addEnv(`.env`, { APP_KEY: 'foo' })

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()

    assert.deepEqual(
      ignitor.application.container.use('Adonis/Src/Config'),
      ignitor.application.container.use('Adonis/Src/Config'),
    )

    assert.deepEqual(
      ignitor.application.container.use('Adonis/Src/Env'),
      ignitor.application.container.use('Adonis/Src/Env'),
    )

    assert.deepEqual(
      ignitor.application.container.use('Adonis/Src/Route'),
      ignitor.application.container.use('Adonis/Src/Route'),
    )

    assert.deepEqual(
      ignitor.application.container.use('Adonis/Src/Server'),
      ignitor.application.container.use('Adonis/Src/Server'),
    )

    assert.deepEqual(
      ignitor.application.container.use('Adonis/Src/MiddlewareStore'),
      ignitor.application.container.use('Adonis/Src/MiddlewareStore'),
    )

    const config = ignitor.application.container.use('Adonis/Src/Config')
    const env = ignitor.application.container.use('Adonis/Src/Env')

    assert.equal(config.get('app.appKey'), 'foo')
    assert.equal(env.get('APP_KEY'), 'foo')
  })

  test('on boot load preload files', async (assert) => {
    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add(`start/route.ts`, `
      const Config = global['use']('Adonis/Src/Config')
      Config.set('routeLoaded', true)
    `)

    await fs.add(`config/app.ts`, '')

    await fs.add('.adonisrc.json', JSON.stringify({
      preloads: [{
        file: 'start/route',
      }],
    }))

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()

    const config = ignitor.application.container.use('Adonis/Src/Config')
    assert.isTrue(config.get('routeLoaded'))
  })

  test('ignore preload files defined for a different environment', async (assert) => {
    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add(`start/route.ts`, `
      const Config = global['use']('Adonis/Src/Config')
      Config.set('routeLoaded', true)
    `)

    await fs.add(`config/app.ts`, '')

    await fs.add('.adonisrc.json', JSON.stringify({
      preloads: [
        {
          file: 'start/route',
          environment: ['web'],
        },
        {
          file: 'start/kernel',
          environment: ['console'],
        },
      ],
    }))

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()

    const config = ignitor.application.container.use('Adonis/Src/Config')
    assert.isTrue(config.get('routeLoaded'))
  })

  test('raise error when preload file is missing', async (assert) => {
    assert.plan(1)

    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add(`start/route.ts`, '')
    await fs.add(`config/app.ts`, '')

    await fs.add('.adonisrc.json', JSON.stringify({
      preloads: [
        {
          file: 'start/route',
          environment: ['web'],
        },
        {
          file: 'start/kernel',
          environment: ['web'],
        },
      ],
    }))

    const ignitor = new Ignitor(fs.basePath)

    try {
      await ignitor.bootstrap()
    } catch ({ message }) {
      assert.match(message, new RegExp(`Cannot find module '${join(fs.basePath, 'start/kernel')}'`))
    }
  })

  test('ignore missing preload files when marked as optional', async () => {
    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add(`start/route.ts`, '')
    await fs.add(`config/app.ts`, '')

    await fs.add('.adonisrc.json', JSON.stringify({
      preloads: [
        {
          file: 'start/route',
          environment: ['web'],
        },
        {
          file: 'start/kernel',
          environment: ['web'],
          optional: true,
        },
      ],
    }))

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()
  })

  test('define autoload aliases with ioc container', async (assert) => {
    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add('.adonisrc.json', JSON.stringify({
      autoloads: {
        'App': './app',
      },
    }))

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()

    assert.deepEqual(ignitor.application.container.autoloads, { App: join(fs.basePath, 'app') })
  })

  test('call httpServerHooks when http server is created', async (assert) => {
    await fs.fsExtra.ensureDir(join(fs.basePath, 'config'))
    await fs.add('.adonisrc.json', JSON.stringify({
      autoloads: {
        'App': './app',
      },
    }))

    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}',
      '${join(fs.basePath, 'providers/AppProvider.ts')}'
    ]`)

    await fs.add('app/Exceptions/Handler.ts', `
      export default class Handler {
        async handle (error) {
          return \`handled \${error.message}\`
        }

        report () {
        }
      }
    `)

    await fs.add('providers/AppProvider.ts', `
    export default class AppProvider {
      constructor (protected $container) {}

      public async onHttpServer () {
        this.$container.use('Adonis/Src/Server').hookCalled = true
      }
    }
    `)

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.startHttpServer()
    const server = ignitor.application.container.use('Adonis/Src/Server')
    server.instance.close()

    assert.isTrue(server.hookCalled)
  })

  test('start http server to accept incoming requests', async (assert) => {
    await fs.fsExtra.ensureDir(join(fs.basePath, 'config'))
    await fs.add('.adonisrc.json', JSON.stringify({
      autoloads: {
        'App': './app',
      },
    }))

    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add('app/Exceptions/Handler.ts', `
      export default class Handler {
        async handle (error) {
          return \`handled \${error.message}\`
        }

        report () {
        }
      }
    `)

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()

    ignitor.application.container.use('Adonis/Src/Route').get('/', () => 'handled')

    await ignitor.startHttpServer((handler) => createServer(handler))
    const server = ignitor.application.container.use('Adonis/Src/Server')

    const { text } = await supertest(server.instance).get('/').expect(200)
    server.instance.close()

    assert.equal(text, 'handled')
  })

  test('forward errors to app error handler', async (assert) => {
    await fs.fsExtra.ensureDir(join(fs.basePath, 'config'))

    await fs.add(`start/app.ts`, `export const providers = [
      '${join(__dirname, '../providers/AppProvider.ts')}'
    ]`)

    await fs.add('.adonisrc.json', JSON.stringify({
      autoloads: {
        'App': './app',
      },
    }))

    await fs.add('app/Exceptions/Handler.ts', `
      export default class Handler {
        async handle (error) {
          return \`handled \${error.message}\`
        }

        report () {
        }
      }
    `)

    const ignitor = new Ignitor(fs.basePath)
    await ignitor.bootstrap()

    await ignitor.startHttpServer((handler) => createServer(handler))
    const server = ignitor.application.container.use('Adonis/Src/Server')
    server.instance.close()

    const { text } = await supertest(server.instance).get('/').expect(404)
    assert.equal(text, 'handled E_ROUTE_NOT_FOUND: Cannot GET:/')
  })
})