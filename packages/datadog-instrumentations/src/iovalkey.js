'use strict'

const {
  channel,
  addHook,
  AsyncResource
} = require('./helpers/instrument')
const shimmer = require('../../datadog-shimmer')

const startCh = channel('apm:iovalkey:command:start')
const finishCh = channel('apm:iovalkey:command:finish')
const errorCh = channel('apm:iovalkey:command:error')

addHook({ name: 'iovalkey', versions: ['>=0'] }, Redis => {
  shimmer.wrap(Redis.prototype, 'sendCommand', sendCommand => function (command, stream) {
    if (!startCh.hasSubscribers) return sendCommand.apply(this, arguments)

    if (!command || !command.promise) return sendCommand.apply(this, arguments)

    const options = this.options || {}
    const connectionName = options.connectionName
    const db = options.db
    const connectionOptions = { host: options.host, port: options.port }

    const asyncResource = new AsyncResource('bound-anonymous-fn')
    return asyncResource.runInAsyncScope(() => {
      startCh.publish({ db, command: command.name, args: command.args, connectionOptions, connectionName })

      const onResolve = asyncResource.bind(() => finish(finishCh, errorCh))
      const onReject = asyncResource.bind(err => finish(finishCh, errorCh, err))

      command.promise.then(onResolve, onReject)

      try {
        return sendCommand.apply(this, arguments)
      } catch (err) {
        errorCh.publish(err)

        throw err
      }
    })
  })
  return Redis
})

function finish (finishCh, errorCh, error) {
  if (error) {
    errorCh.publish(error)
  }
  finishCh.publish()
}
