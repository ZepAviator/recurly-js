'use strict'

const crypto = require('crypto')
const Tools = require('./tools')

module.exports = function (config) {

  const t = new Tools(config)

  const TRANSPARENT_POST_BASE_URL = config.RECURLY_BASE_URL + '/transparent/' + config.SUBDOMAIN
  const BILLING_INFO_URL = TRANSPARENT_POST_BASE_URL + '/billing_info'
  const SUBSCRIBE_URL = TRANSPARENT_POST_BASE_URL + '/subscription'
  const TRANSACTION_URL = TRANSPARENT_POST_BASE_URL + '/transaction'

  t.debug('============================')
  t.debug(TRANSPARENT_POST_BASE_URL)
  t.debug(BILLING_INFO_URL)
  t.debug(SUBSCRIBE_URL)
  t.debug(TRANSACTION_URL)
  t.debug('============================')

  this.billingInfoUrl = function () {
    return BILLING_INFO_URL
  }
  this.subscribeUrl = function () {
    return SUBSCRIBE_URL
  }
  this.transactionUrl = function () {
    return TRANSACTION_URL
  }

  this.hidden_field = function (data) {
    return '<input type="hidden" name="data" value="' + t.htmlEscape(encodedData(data)) + '" />'
  }

  this.getResults = function (confirm, result, status, type, callback) {
    validateQueryString(confirm, type, status, result)
    t.request('/transparent/results/' + result, 'GET', callback)
  }

  this.getFormValuesFromResult = function getFormValuesFromResult(result, type) {
    const fields = {}
    let errors = []
    t.traverse(result.data, function (key, value, parent) {
      let shouldprint = false
      let toprint = ''
      if (value instanceof Object) {
        if (Object.keys(value).length === 0) {
          shouldprint = true
          toprint = ''
        }
        if (Object.hasOwnProperty('@') || Object.hasOwnProperty('#')) {
          shouldprint = true
          toprint = value
        }
        if (value instanceof Array) {
          shouldprint = true
          toprint = value
        }
      }
      else if (!(value instanceof Object)) {
        shouldprint = true
        toprint = value
        if (key === 'error') {
          errors.push({ field: '_general', reason: value })
          shouldprint = false
        }
      }
      if (key === '@' || key === '#') {
        shouldprint = false
      }
      if (parent === '@' || parent === '#') {
        shouldprint = false
      }

      if (!parent) {
        switch (type) {
          case 'subscribe':
          {
            parent = 'account'
            break
          }
          case 'billing_info':
          {
            parent = 'billing_info'
          }
        }
      }

      if (key === 'errors') {
        shouldprint = false
        errors = errors.concat(processErrors(value, parent))
      }

      if (shouldprint) {

        try {
          fields[parent + '[' + key + ']'] = toprint.replace(/'/g, '&apos;')
        }
        catch (e) {
          t.debug('GET FIELDS: could not process: ' + parent + '[' + key + '] : ' + toprint)
        }
      }
    })
    errors = handleFuzzyLogicSpecialCases(errors)
    return { fields: fields, errors: errors }
  }

  function processErrors(errors, parent) {
    const acc = []
    const processSingleError = function (e) {
      try {
        acc.push({
          field: parent + '[' + e['@'].field + ']',
          reason: e['#'].replace(/'/g, '&apos;')
        })
      }
      catch (err) {
        t.debug('Could not process listed error: ' + e)
      }
    }
    errors.forEach(function (item) {
      if (item instanceof Array) {
        item.forEach(processSingleError)
      }
      else {
        try {
          processSingleError(item)
        }
        catch (err) {
          t.debug('Could not process single error: ' + item)
        }
      }
    })
    return acc
  }

  function encodedData(data) {
    verifyRequiredFields(data)
    const queryString = makeQueryString(data)
    const validationString = hash(queryString)
    return validationString + '|' + queryString
  }

  function verifyRequiredFields(params) {
    if (!params.hasOwnProperty('redirect_url')) {
      throw 'Missing required parameter: redirect_url'
    }
    if (!params.hasOwnProperty('account[account_code]')) {
      throw 'Missing required parameter: account[account_code]'
    }
  }

  function makeQueryString(params) {
    params.time = makeDate()
    return buildQueryStringFromSortedObject(makeSortedObject(params, true))
  }

  function makeDate() {
    const d = new Date()
    const addleadingzero = function (n) {
      return n < 10 ? '0' + n : n.toString()
    }
    return d.getUTCFullYear() + '-' +
      addleadingzero(d.getUTCMonth() + 1) + '-' +
      addleadingzero(d.getUTCDate()) + 'T' +
      addleadingzero(d.getUTCHours()) + ':' +
      addleadingzero(d.getUTCMinutes()) + ':' +
      addleadingzero(d.getUTCSeconds()) + 'Z'
  }

  function hash(data) {
    //get the sha1 of the private key in binary
    let shakey = crypto.createHash('sha1')
    shakey.update(config.PRIVATE_KEY)
    shakey = shakey.digest('binary')
    //now make an hmac and return it as hex
    const hmac = crypto.createHmac('sha1', shakey)
    hmac.update(data)
    return hmac.digest('hex')
    //php:  03021207ad681f2ea9b9e1fc20ac7ae460d8d988    <== Yes this sign is identical to the php version
    //node: 03021207ad681f2ea9b9e1fc20ac7ae460d8d988
  }

  function buildQueryStringFromSortedObject(params) {
    return params.map(function (p) {
      return escape(p.key) + '=' + t.urlEncode(p.value)
    }).join('&')
  }

  function makeSortedObject(obj, casesensitive) {
    return Object.keys(obj).map(function (key) {
      return { key: key, value: obj[key] }
    }).sort(function (a, b) {
      return (casesensitive ? a.key : a.key.toLowerCase()) > (casesensitive ? b.key : b.key.toLowerCase())
    })
  }

  //Used for validating return params from Recurly
  function validateQueryString(confirm, type, status, resultKeys) {
    const values = {
      result: resultKeys,
      status: status,
      type: type
    }
    const queryValues = buildQueryStringFromSortedObject(makeSortedObject(values, true))
    const hashedValues = hash(queryValues)

    if (hashedValues !== confirm) {
      throw 'Error: Forged query string'
    }
    return true
  }

  function handleFuzzyLogicSpecialCases(errors) {
    const toreturn = []
    errors.forEach(function (e) {
      switch (e.field) {
        case 'billing_info[verification_value]':
        {
          toreturn.push(copyWithNewName('billing_info[credit_card][verification_value]', e))
          toreturn.push(copyWithNewName('credit_card[verification_value]', e))
          break
        }
        case 'credit_card[number]':
        {
          toreturn.push(copyWithNewName('billing_info[credit_card][number]', e))
          toreturn.push(e)
          break
        }
        default:
        {
          toreturn.push(e)
          break
        }
      }
    })
    return toreturn
  }

  function copyWithNewName(name, error) {
    return {
      field: name,
      reason: error.reason
    }
  }

}
