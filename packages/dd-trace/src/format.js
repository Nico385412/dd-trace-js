'use strict'

const constants = require('./constants')
const tags = require('../../../ext/tags')
const id = require('./id')
const { isError } = require('./util')
const { registerExtraService } = require('./service-naming/extra-services')

const SAMPLING_PRIORITY_KEY = constants.SAMPLING_PRIORITY_KEY
const SAMPLING_RULE_DECISION = constants.SAMPLING_RULE_DECISION
const SAMPLING_LIMIT_DECISION = constants.SAMPLING_LIMIT_DECISION
const SAMPLING_AGENT_DECISION = constants.SAMPLING_AGENT_DECISION
const SPAN_SAMPLING_MECHANISM = constants.SPAN_SAMPLING_MECHANISM
const SPAN_SAMPLING_RULE_RATE = constants.SPAN_SAMPLING_RULE_RATE
const SPAN_SAMPLING_MAX_PER_SECOND = constants.SPAN_SAMPLING_MAX_PER_SECOND
const SAMPLING_MECHANISM_SPAN = constants.SAMPLING_MECHANISM_SPAN
const { MEASURED, BASE_SERVICE, ANALYTICS } = tags
const ORIGIN_KEY = constants.ORIGIN_KEY
const HOSTNAME_KEY = constants.HOSTNAME_KEY
const TOP_LEVEL_KEY = constants.TOP_LEVEL_KEY
const PROCESS_ID = constants.PROCESS_ID
const ERROR_MESSAGE = constants.ERROR_MESSAGE
const ERROR_STACK = constants.ERROR_STACK
const ERROR_TYPE = constants.ERROR_TYPE

const map = {
  'operation.name': 'name',
  'service.name': 'service',
  'span.type': 'type',
  'resource.name': 'resource'
}

function format (span) {
  const formatted = formatSpan(span)

  extractSpanLinks(formatted, span)
  extractSpanEvents(formatted, span)
  extractRootTags(formatted, span)
  extractChunkTags(formatted, span)
  extractTags(formatted, span)

  return formatted
}

function formatSpan (span) {
  const spanContext = span.context()

  return {
    trace_id: spanContext._traceId,
    span_id: spanContext._spanId,
    parent_id: spanContext._parentId || id('0'),
    name: String(spanContext._name),
    resource: String(spanContext._name),
    error: 0,
    meta: {},
    meta_struct: span.meta_struct,
    metrics: {},
    start: Math.round(span._startTime * 1e6),
    duration: Math.round(span._duration * 1e6),
    links: []
  }
}

function setSingleSpanIngestionTags (span, options) {
  if (!options) return
  addTag({}, span.metrics, SPAN_SAMPLING_MECHANISM, SAMPLING_MECHANISM_SPAN)
  addTag({}, span.metrics, SPAN_SAMPLING_RULE_RATE, options.sampleRate)
  addTag({}, span.metrics, SPAN_SAMPLING_MAX_PER_SECOND, options.maxPerSecond)
}

function extractSpanLinks (formattedSpan, span) {
  const links = []
  if (span._links) {
    for (const link of span._links) {
      const { context, attributes } = link
      const formattedLink = {}

      formattedLink.trace_id = context.toTraceId(true)
      formattedLink.span_id = context.toSpanId(true)

      if (attributes && Object.keys(attributes).length > 0) {
        formattedLink.attributes = attributes
      }
      if (context?._sampling?.priority >= 0) formattedLink.flags = context._sampling.priority > 0 ? 1 : 0
      if (context?._tracestate) formattedLink.tracestate = context._tracestate.toString()

      links.push(formattedLink)
    }
  }
  if (links.length > 0) { formattedSpan.meta['_dd.span_links'] = JSON.stringify(links) }
}

function extractSpanEvents (formattedSpan, span) {
  const events = []
  if (span._events) {
    for (const event of span._events) {
      const formattedEvent = {
        name: event.name,
        time_unix_nano: Math.round(event.startTime * 1e6),
        attributes: event.attributes && Object.keys(event.attributes).length > 0 ? event.attributes : undefined
      }

      events.push(formattedEvent)
    }
  }
  if (events.length > 0) {
    formattedSpan.span_events = events
  }
}

function extractTags (formattedSpan, span) {
  const context = span.context()
  const origin = context._trace.origin
  const tags = context._tags
  const hostname = context._hostname
  const priority = context._sampling.priority

  if (tags['span.kind'] && tags['span.kind'] !== 'internal') {
    addTag({}, formattedSpan.metrics, MEASURED, 1)
  }

  const tracerService = span.tracer()._service.toLowerCase()
  if (tags['service.name']?.toLowerCase() !== tracerService) {
    span.setTag(BASE_SERVICE, tracerService)

    registerExtraService(tags['service.name'])
  }

  for (const tag in tags) {
    switch (tag) {
      case 'service.name':
      case 'span.type':
      case 'resource.name':
        addTag(formattedSpan, {}, map[tag], tags[tag])
        break
      // HACK: remove when Datadog supports numeric status code
      case 'http.status_code':
        addTag(formattedSpan.meta, {}, tag, tags[tag] && String(tags[tag]))
        break
      case 'analytics.event':
        addTag({}, formattedSpan.metrics, ANALYTICS, tags[tag] === undefined || tags[tag] ? 1 : 0)
        break
      case HOSTNAME_KEY:
      case MEASURED:
        addTag({}, formattedSpan.metrics, tag, tags[tag] === undefined || tags[tag] ? 1 : 0)
        break
      case 'error':
        if (context._name !== 'fs.operation') {
          extractError(formattedSpan, tags[tag])
        }
        break
      case ERROR_TYPE:
      case ERROR_MESSAGE:
      case ERROR_STACK:
        // HACK: remove when implemented in the backend
        if (context._name !== 'fs.operation') {
          // HACK: to ensure otel.recordException does not influence formattedSpan.error
          if (tags.setTraceError) {
            formattedSpan.error = 1
          }
        } else {
          break
        }
      default: // eslint-disable-line no-fallthrough
        addTag(formattedSpan.meta, formattedSpan.metrics, tag, tags[tag])
    }
  }
  setSingleSpanIngestionTags(formattedSpan, context._spanSampling)

  addTag(formattedSpan.meta, formattedSpan.metrics, 'language', 'javascript')
  addTag(formattedSpan.meta, formattedSpan.metrics, PROCESS_ID, process.pid)
  addTag(formattedSpan.meta, formattedSpan.metrics, SAMPLING_PRIORITY_KEY, priority)
  addTag(formattedSpan.meta, formattedSpan.metrics, ORIGIN_KEY, origin)
  addTag(formattedSpan.meta, formattedSpan.metrics, HOSTNAME_KEY, hostname)
}

function extractRootTags (formattedSpan, span) {
  const context = span.context()
  const isLocalRoot = span === context._trace.started[0]
  const parentId = context._parentId

  if (!isLocalRoot || (parentId && parentId.toString(10) !== '0')) return

  addTag({}, formattedSpan.metrics, SAMPLING_RULE_DECISION, context._trace[SAMPLING_RULE_DECISION])
  addTag({}, formattedSpan.metrics, SAMPLING_LIMIT_DECISION, context._trace[SAMPLING_LIMIT_DECISION])
  addTag({}, formattedSpan.metrics, SAMPLING_AGENT_DECISION, context._trace[SAMPLING_AGENT_DECISION])
  addTag({}, formattedSpan.metrics, TOP_LEVEL_KEY, 1)
}

function extractChunkTags (formattedSpan, span) {
  const context = span.context()
  const isLocalRoot = span === context._trace.started[0]

  if (!isLocalRoot) return

  for (const key in context._trace.tags) {
    addTag(formattedSpan.meta, formattedSpan.metrics, key, context._trace.tags[key])
  }
}

function extractError (formattedSpan, error) {
  if (!error) return

  formattedSpan.error = 1

  if (isError(error)) {
    // AggregateError only has a code and no message.
    addTag(formattedSpan.meta, formattedSpan.metrics, ERROR_MESSAGE, error.message || error.code)
    addTag(formattedSpan.meta, formattedSpan.metrics, ERROR_TYPE, error.name)
    addTag(formattedSpan.meta, formattedSpan.metrics, ERROR_STACK, error.stack)
  }
}

function addTag (meta, metrics, key, value, nested) {
  switch (typeof value) {
    case 'string':
      meta[key] = value
      break
    case 'number':
      if (isNaN(value)) break
      metrics[key] = value
      break
    case 'boolean':
      metrics[key] = value ? 1 : 0
      break
    case 'undefined':
      break
    case 'object':
      if (value === null) break

      // Special case for Node.js Buffer and URL
      if (isNodeBuffer(value) || isUrl(value)) {
        metrics[key] = value.toString()
      } else if (!Array.isArray(value) && !nested) {
        for (const prop in value) {
          if (!hasOwn(value, prop)) continue

          addTag(meta, metrics, `${key}.${prop}`, value[prop], true)
        }
      }

      break
  }
}

function hasOwn (object, prop) {
  return Object.prototype.hasOwnProperty.call(object, prop)
}

function isNodeBuffer (obj) {
  return obj.constructor && obj.constructor.name === 'Buffer' &&
    typeof obj.readInt8 === 'function' &&
    typeof obj.toString === 'function'
}

function isUrl (obj) {
  return obj.constructor && obj.constructor.name === 'URL' &&
    typeof obj.href === 'string' &&
    typeof obj.toString === 'function'
}

module.exports = format
