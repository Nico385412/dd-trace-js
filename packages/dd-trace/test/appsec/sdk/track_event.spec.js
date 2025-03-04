'use strict'

const proxyquire = require('proxyquire')
const agent = require('../../plugins/agent')
const axios = require('axios')
const tracer = require('../../../../../index')
const { LOGIN_SUCCESS, LOGIN_FAILURE } = require('../../../src/appsec/addresses')
const { SAMPLING_MECHANISM_APPSEC } = require('../../../src/constants')
const { USER_KEEP } = require('../../../../../ext/priority')

describe('track_event', () => {
  describe('Internal API', () => {
    const tracer = {}
    let log
    let rootSpan
    let getRootSpan
    let setUserTags
    let trackUserLoginSuccessEvent, trackUserLoginFailureEvent, trackCustomEvent, trackEvent
    let sample
    let waf
    let prioritySampler

    beforeEach(() => {
      log = {
        warn: sinon.stub()
      }

      prioritySampler = {
        setPriority: sinon.stub()
      }

      rootSpan = {
        _prioritySampler: prioritySampler,
        addTags: sinon.stub(),
        keep: sinon.stub()
      }

      getRootSpan = sinon.stub().callsFake(() => rootSpan)

      setUserTags = sinon.stub()

      sample = sinon.stub()

      waf = {
        run: sinon.spy()
      }

      const trackEvents = proxyquire('../../../src/appsec/sdk/track_event', {
        '../../log': log,
        './utils': {
          getRootSpan
        },
        './set_user': {
          setUserTags
        },
        '../standalone': {
          sample
        },
        '../waf': waf
      })

      trackUserLoginSuccessEvent = trackEvents.trackUserLoginSuccessEvent
      trackUserLoginFailureEvent = trackEvents.trackUserLoginFailureEvent
      trackCustomEvent = trackEvents.trackCustomEvent
      trackEvent = trackEvents.trackEvent
    })

    afterEach(() => {
      sinon.restore()
    })

    describe('trackUserLoginSuccessEvent', () => {
      it('should log warning when passed invalid user', () => {
        trackUserLoginSuccessEvent(tracer, null, { key: 'value' })
        trackUserLoginSuccessEvent(tracer, {}, { key: 'value' })

        expect(log.warn).to.have.been.calledTwice
        expect(log.warn.firstCall)
          .to.have.been.calledWithExactly('[ASM] Invalid user provided to trackUserLoginSuccessEvent')
        expect(log.warn.secondCall)
          .to.have.been.calledWithExactly('[ASM] Invalid user provided to trackUserLoginSuccessEvent')
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.not.have.been.called
      })

      it('should log warning when root span is not available', () => {
        rootSpan = undefined

        trackUserLoginSuccessEvent(tracer, { id: 'user_id' }, { key: 'value' })

        expect(log.warn)
          .to.have.been.calledOnceWithExactly('[ASM] Root span not available in trackUserLoginSuccessEvent')
        expect(setUserTags).to.not.have.been.called
      })

      it('should call setUser and addTags with metadata', () => {
        const user = { id: 'user_id' }

        trackUserLoginSuccessEvent(tracer, user, {
          metakey1: 'metaValue1',
          metakey2: 'metaValue2',
          metakey3: 'metaValue3'
        })

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.have.been.calledOnceWithExactly(user, rootSpan)
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly(
          {
            'appsec.events.users.login.success.track': 'true',
            '_dd.appsec.events.users.login.success.sdk': 'true',
            'appsec.events.users.login.success.metakey1': 'metaValue1',
            'appsec.events.users.login.success.metakey2': 'metaValue2',
            'appsec.events.users.login.success.metakey3': 'metaValue3'
          })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call setUser and addTags without metadata', () => {
        const user = { id: 'user_id' }

        trackUserLoginSuccessEvent(tracer, user)

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.have.been.calledOnceWithExactly(user, rootSpan)
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.users.login.success.track': 'true',
          '_dd.appsec.events.users.login.success.sdk': 'true'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call waf run with login success address', () => {
        const user = { id: 'user_id' }

        trackUserLoginSuccessEvent(tracer, user)
        sinon.assert.calledOnceWithExactly(
          waf.run,
          { persistent: { [LOGIN_SUCCESS]: null } }
        )
      })
    })

    describe('trackUserLoginFailureEvent', () => {
      it('should log warning when passed invalid userId', () => {
        trackUserLoginFailureEvent(tracer, null, false)
        trackUserLoginFailureEvent(tracer, [], false)

        expect(log.warn).to.have.been.calledTwice
        expect(log.warn.firstCall)
          .to.have.been.calledWithExactly('[ASM] Invalid userId provided to trackUserLoginFailureEvent')
        expect(log.warn.secondCall)
          .to.have.been.calledWithExactly('[ASM] Invalid userId provided to trackUserLoginFailureEvent')
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.not.have.been.called
      })

      it('should log warning when root span is not available', () => {
        rootSpan = undefined

        trackUserLoginFailureEvent(tracer, 'user_id', false)

        expect(log.warn)
          .to.have.been.calledOnceWithExactly('[ASM] Root span not available in %s', 'trackUserLoginFailureEvent')
        expect(setUserTags).to.not.have.been.called
      })

      it('should call addTags with metadata', () => {
        trackUserLoginFailureEvent(tracer, 'user_id', true, {
          metakey1: 'metaValue1', metakey2: 'metaValue2', metakey3: 'metaValue3'
        })

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.users.login.failure.track': 'true',
          '_dd.appsec.events.users.login.failure.sdk': 'true',
          'appsec.events.users.login.failure.usr.id': 'user_id',
          'appsec.events.users.login.failure.usr.exists': 'true',
          'appsec.events.users.login.failure.metakey1': 'metaValue1',
          'appsec.events.users.login.failure.metakey2': 'metaValue2',
          'appsec.events.users.login.failure.metakey3': 'metaValue3'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should send false `usr.exists` property when the user does not exist', () => {
        trackUserLoginFailureEvent(tracer, 'user_id', false, {
          metakey1: 'metaValue1', metakey2: 'metaValue2', metakey3: 'metaValue3'
        })

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.users.login.failure.track': 'true',
          '_dd.appsec.events.users.login.failure.sdk': 'true',
          'appsec.events.users.login.failure.usr.id': 'user_id',
          'appsec.events.users.login.failure.usr.exists': 'false',
          'appsec.events.users.login.failure.metakey1': 'metaValue1',
          'appsec.events.users.login.failure.metakey2': 'metaValue2',
          'appsec.events.users.login.failure.metakey3': 'metaValue3'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call addTags without metadata', () => {
        trackUserLoginFailureEvent(tracer, 'user_id', true)

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.users.login.failure.track': 'true',
          '_dd.appsec.events.users.login.failure.sdk': 'true',
          'appsec.events.users.login.failure.usr.id': 'user_id',
          'appsec.events.users.login.failure.usr.exists': 'true'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call waf run with login failure address', () => {
        trackUserLoginFailureEvent(tracer, 'user_id')
        sinon.assert.calledOnceWithExactly(
          waf.run,
          { persistent: { [LOGIN_FAILURE]: null } }
        )
      })
    })

    describe('trackCustomEvent', () => {
      it('should log warning when passed invalid eventName', () => {
        trackCustomEvent(tracer, null)
        trackCustomEvent(tracer, { name: 'name' })

        expect(log.warn).to.have.been.calledTwice
        expect(log.warn.firstCall)
          .to.have.been.calledWithExactly('[ASM] Invalid eventName provided to trackCustomEvent')
        expect(log.warn.secondCall)
          .to.have.been.calledWithExactly('[ASM] Invalid eventName provided to trackCustomEvent')
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.not.have.been.called
      })

      it('should log warning when root span is not available', () => {
        rootSpan = undefined

        trackCustomEvent(tracer, 'custom_event')

        expect(log.warn)
          .to.have.been.calledOnceWithExactly('[ASM] Root span not available in %s', 'trackCustomEvent')
        expect(setUserTags).to.not.have.been.called
      })

      it('should call addTags with metadata', () => {
        trackCustomEvent(tracer, 'custom_event', { metaKey1: 'metaValue1', metakey2: 'metaValue2' })

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.custom_event.track': 'true',
          '_dd.appsec.events.custom_event.sdk': 'true',
          'appsec.events.custom_event.metaKey1': 'metaValue1',
          'appsec.events.custom_event.metakey2': 'metaValue2'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call addTags without metadata', () => {
        trackCustomEvent(tracer, 'custom_event')

        expect(log.warn).to.not.have.been.called
        expect(setUserTags).to.not.have.been.called
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.custom_event.track': 'true',
          '_dd.appsec.events.custom_event.sdk': 'true'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })
    })

    describe('trackEvent', () => {
      it('should call addTags with safe mode', () => {
        trackEvent('event', { metaKey1: 'metaValue1', metakey2: 'metaValue2' }, 'trackEvent', rootSpan, 'safe')
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.event.track': 'true',
          '_dd.appsec.events.event.auto.mode': 'safe',
          'appsec.events.event.metaKey1': 'metaValue1',
          'appsec.events.event.metakey2': 'metaValue2'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call addTags with extended mode', () => {
        trackEvent('event', { metaKey1: 'metaValue1', metakey2: 'metaValue2' }, 'trackEvent', rootSpan, 'extended')
        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.event.track': 'true',
          '_dd.appsec.events.event.auto.mode': 'extended',
          'appsec.events.event.metaKey1': 'metaValue1',
          'appsec.events.event.metakey2': 'metaValue2'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
      })

      it('should call standalone sample', () => {
        trackEvent('event', undefined, 'trackEvent', rootSpan, undefined)

        expect(rootSpan.addTags).to.have.been.calledOnceWithExactly({
          'appsec.events.event.track': 'true'
        })
        expect(prioritySampler.setPriority)
          .to.have.been.calledOnceWithExactly(rootSpan, USER_KEEP, SAMPLING_MECHANISM_APPSEC)
        expect(sample).to.have.been.calledOnceWithExactly(rootSpan)
      })
    })
  })

  describe('Integration with the tracer', () => {
    let http
    let controller
    let appListener
    let port

    function listener (req, res) {
      if (controller) {
        controller(req, res)
      }
    }

    before(async () => {
      await agent.load('http')
      http = require('http')
    })

    before(done => {
      const server = new http.Server(listener)
      appListener = server
        .listen(port, 'localhost', () => {
          port = appListener.address().port
          done()
        })
    })

    after(() => {
      appListener.close()
      return agent.close({ ritmReset: false })
    })

    describe('trackUserLoginSuccessEvent', () => {
      it('should track valid user', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackUserLoginSuccessEvent({
            id: 'test_user_id'
          }, { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.success.track', 'true')
          expect(traces[0][0].meta).to.have.property('usr.id', 'test_user_id')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.success.metakey', 'metaValue')
          expect(traces[0][0].metrics).to.have.property('_sampling_priority_v1', USER_KEEP)
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })

      it('should not track without user', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackUserLoginSuccessEvent(undefined, { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.not.have.property('appsec.events.users.login.success.track', 'true')
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })

      it('should not track without calling the sdk method', (done) => {
        controller = (req, res) => {
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.not.have.property('appsec.events.users.login.success.track', 'true')
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })
    })

    describe('trackUserLoginFailureEvent', () => {
      it('should track valid existing user', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackUserLoginFailureEvent('test_user_id', true, { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.track', 'true')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.usr.id', 'test_user_id')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.usr.exists', 'true')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.metakey', 'metaValue')
          expect(traces[0][0].metrics).to.have.property('_sampling_priority_v1', USER_KEEP)
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })

      it('should track valid non existing user', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackUserLoginFailureEvent('test_user_id', false, { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.track', 'true')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.usr.id', 'test_user_id')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.usr.exists', 'false')
          expect(traces[0][0].meta).to.have.property('appsec.events.users.login.failure.metakey', 'metaValue')
          expect(traces[0][0].metrics).to.have.property('_sampling_priority_v1', USER_KEEP)
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })

      it('should not track without user', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackUserLoginFailureEvent(undefined, false, { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.not.have.property('appsec.events.users.login.failure.track', 'true')
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })

      it('should not track without calling the sdk method', (done) => {
        controller = (req, res) => {
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.not.have.property('appsec.events.users.login.failure.track', 'true')
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })
    })

    describe('trackCustomEvent', () => {
      it('should track valid event name', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackCustomEvent('my-custom-event', { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].meta).to.have.property('appsec.events.my-custom-event.track', 'true')
          expect(traces[0][0].meta).to.have.property('appsec.events.my-custom-event.metakey', 'metaValue')
          expect(traces[0][0].metrics).to.have.property('_sampling_priority_v1', USER_KEEP)
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })

      it('should not track invalid event name', (done) => {
        controller = (req, res) => {
          tracer.appsec.trackCustomEvent(null, { metakey: 'metaValue' })
          tracer.appsec.trackCustomEvent({ event: 'name' }, { metakey: 'metaValue' })
          res.end()
        }
        agent.use(traces => {
          expect(traces[0][0].metrics).to.not.have.property('_sampling_priority_v1', USER_KEEP)
        }).then(done).catch(done)
        axios.get(`http://localhost:${port}/`)
      })
    })
  })
})
