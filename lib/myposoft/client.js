// lib/myposoft/client.js
// Cliente para MyPOSoft POS - auth Symfony + endpoints DataTables
// Usar SOLO server-side (tiene credenciales)

const BASE = 'https://myposoft.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export class MyPOSoftClient {
  constructor({ user, password } = {}) {
    this.user = user || process.env.MYPOSOFT_USER
    this.password = password || process.env.MYPOSOFT_PASSWORD
    if (!this.user || !this.password) {
      throw new Error('MyPOSoftClient: faltan credenciales (MYPOSOFT_USER, MYPOSOFT_PASSWORD)')
    }
    this.cookieJar = new Map()
    this.csrfToken = null
    this.loggedInAt = null
  }

  // ---------- Helpers internos ----------

  _absorbCookies(response) {
    const setCookies = response.headers.getSetCookie?.() || []
    for (const sc of setCookies) {
      const [pair] = sc.split(';')
      const idx = pair.indexOf('=')
      if (idx < 0) continue
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (value && value !== 'deleted') {
        this.cookieJar.set(name, value)
      }
    }
  }

  _cookieHeader() {
    return [...this.cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  _commonHeaders(referer = BASE) {
    return {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Origin': BASE,
      'Referer': referer,
      'Cookie': this._cookieHeader(),
      'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    }
  }

  hydrate({ cookies, csrfToken, expiresAt }) {
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return false
    }
    this.cookieJar.clear()
    for (const [k, v] of Object.entries(cookies || {})) {
      this.cookieJar.set(k, v)
    }
    this.csrfToken = csrfToken
    this.loggedInAt = new Date()
    return true
  }

  exportSession() {
    return {
      cookies: Object.fromEntries(this.cookieJar),
      csrfToken: this.csrfToken,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }
  }

  // ---------- Auth ----------

  async login() {
    const homeResp = await fetch(`${BASE}/`, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!homeResp.ok) {
      throw new Error(`Login GET / failed: ${homeResp.status}`)
    }
    this._absorbCookies(homeResp)
    const html = await homeResp.text()

    const m = html.match(/name="login\[_csrf_token\]"\s+value="([^"]+)"/)
    if (!m) {
      throw new Error('Login: no se encontró login[_csrf_token] en el HTML')
    }
    this.csrfToken = m[1]

    const body = new URLSearchParams({
      'login[_csrf_token]': this.csrfToken,
      'login[userLogin]': this.user,
      'login[userPassword]': this.password,
    })

    const loginResp = await fetch(`${BASE}/security/login`, {
      method: 'POST',
      headers: {
        ...this._commonHeaders(`${BASE}/`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'manual',
    })

    if (loginResp.status !== 302) {
      const text = await loginResp.text()
      throw new Error(`Login POST falló. Status: ${loginResp.status}. Body: ${text.slice(0, 300)}`)
    }
    this._absorbCookies(loginResp)
    this.loggedInAt = new Date()

    try {
      await this._keyValidation()
    } catch (e) {
      console.warn('keyValidation post-login warning:', e.message)
    }

    return true
  }

  async _keyValidation() {
    const resp = await fetch(`${BASE}/Home/keyValidation`, {
      method: 'POST',
      headers: {
        ...this._commonHeaders(`${BASE}/`),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      body: '',
    })
    this._absorbCookies(resp)
    if (!resp.ok) throw new Error(`keyValidation status ${resp.status}`)
    return resp.json()
  }

  async ensureSession() {
    if (!this.loggedInAt || this.cookieJar.size === 0) {
      return this.login()
    }
    try {
      await this._keyValidation()
      return true
    } catch (e) {
      this.cookieJar.clear()
      this.csrfToken = null
      this.loggedInAt = null
      return this.login()
    }
  }

  // ---------- DataTables helpers ----------

  _buildDataTablesBody({ columns = [], extra = {}, length = -1, draw = 1 }) {
    const params = new URLSearchParams()
    params.set('draw', String(draw))

    columns.forEach((col, i) => {
      params.set(`columns[${i}][data]`, col.data)
      params.set(`columns[${i}][name]`, col.name || col.data)
      params.set(`columns[${i}][searchable]`, String(col.searchable ?? true))
      params.set(`columns[${i}][orderable]`, String(col.orderable ?? true))
      params.set(`columns[${i}][search][value]`, '')
      params.set(`columns[${i}][search][regex]`, 'false')
    })

    params.set('order[0][column]', '1')
    params.set('order[0][dir]', 'desc')
    params.set('start', '0')
    params.set('length', String(length))
    params.set('search[value]', '')
    params.set('search[regex]', 'false')

    for (const [k, v] of Object.entries(extra)) {
      params.set(k, v == null ? '' : String(v))
    }
    return params
  }

  // ---------- Columnas de los endpoints ----------

  static SALE_COLUMNS = [
    { data: 'actions', searchable: false, orderable: false },
    { data: 'id', name: 'Sale.id' },
    { data: 'corpName', name: 'Corp.name' },
    { data: 'busNit', name: 'Bussines.nit' },
    { data: 'busName', name: 'Bussines.name' },
    { data: 'tradeCode', name: 'Trade.code_trade' },
    { data: 'tradeName', name: 'Trade.name' },
    { data: 'saleStatus', name: 'SaleStatus.name' },
    { data: 'correlative', name: 'Sale.sale_correlative' },
    { data: 'correlativeInternal', name: 'Sale.sale_correlative_internal' },
    { data: 'userLogin', name: 'UserPdv.user_login' },
    { data: 'userName', name: 'UserPdv.user_name' },
    { data: 'dateDocument', name: 'Sale.sale_date' },
    { data: 'customerName', name: 'Sale.customer_name' },
    { data: 'customerNit', name: 'Sale.customer_nit' },
    { data: 'customerAddress', name: 'Sale.customer_address' },
    { data: 'customerEmail', name: 'Sale.customer_email' },
    { data: 'currencyName', name: 'Currency.name' },
    { data: 'totalTaxes', name: 'Sale.total_taxes' },
    { data: 'totalNet', name: 'Sale.total_net' },
    { data: 'total', name: 'Sale.total' },
    { data: 'felUuid', name: 'Sale.fel_uuid' },
    { data: 'felNumber', name: 'Sale.fel_number' },
    { data: 'felSerie', name: 'Sale.fel_serie' },
    { data: 'payment-1', searchable: false, orderable: false },
    { data: 'payment-2', searchable: false, orderable: false },
    { data: 'payment-voucher-2', searchable: false, orderable: false },
    { data: 'tax-3', searchable: false, orderable: false },
  ]

  /**
   * Trae ventas desde /Sale/getList
   * @param {object} opts
   * @param {string} opts.startDate - 'YYYY-MM-DD'
   * @param {string} opts.endDate   - 'YYYY-MM-DD'
   * @param {number} [opts.tradeId]
   */
  async getSales({ startDate, endDate, tradeId, businessId, corpId, userId } = {}) {
    if (!startDate || !endDate) {
      throw new Error('getSales: startDate y endDate requeridos (YYYY-MM-DD)')
    }
    await this.ensureSession()

    const body = this._buildDataTablesBody({
      columns: MyPOSoftClient.SALE_COLUMNS,
      length: -1,
      draw: Math.floor(Date.now() / 1000),
      extra: {
        startDate,
        endDate,
        tradeId: tradeId ?? '',
        businessId: businessId ?? '',
        corpId: corpId ?? '',
        userId: userId ?? '',
      },
    })

    const resp = await fetch(`${BASE}/Sale/getList`, {
      method: 'POST',
      headers: {
        ...this._commonHeaders(`${BASE}/Sale`),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      body,
    })
    this._absorbCookies(resp)

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`getSales status ${resp.status}: ${txt.slice(0, 200)}`)
    }

    const json = await resp.json()
    return {
      records: parseInt(json.iTotalDisplayRecords || '0', 10),
      sales: json.aaData || [],
    }
  }
}