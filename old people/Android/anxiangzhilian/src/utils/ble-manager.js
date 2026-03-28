/**
 * BLE Manager - ElderCare ESP32 蓝牙通信服务
 * 
 * 使用 Web Bluetooth API 连接 ESP32 设备
 * 支持 Nordic UART Service (NUS) 协议
 * 
 * BLE Service UUID: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 * BLE TX UUID (Phone→ESP32): 6E400002-B5A3-F393-E0A9-E50E24DCCA9E
 * BLE RX UUID (ESP32→Phone): 6E400003-B5A3-F393-E0A9-E50E24DCCA9E
 */

const SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'
const CHAR_RX_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'  // ESP32 receives
const CHAR_TX_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'  // ESP32 sends

const DEVICE_NAME_PREFIX = 'ElderCare_ESP32'
const SCAN_TIMEOUT_MS = 15000
const CONNECT_TIMEOUT_MS = 10000
const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_ATTEMPTS = 3

class BLEManager {
  constructor() {
    this.device = null
    this.server = null
    this.service = null
    this.txCharacteristic = null  // For sending TO ESP32
    this.rxCharacteristic = null // For receiving FROM ESP32
    
    this.isConnected = false
    this.isScanning = false
    this.isInitialized = false
    
    this.onSensorData = null        // Callback: (SensorData) => void
    this.onConnectionChange = null  // Callback: (connected: boolean) => void
    this.onError = null            // Callback: (error: string) => void
    this.onLog = null              // Callback: (message: string) => void
    
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.scanTimeoutTimer = null
    
    // Command queue when disconnected
    this.commandQueue = []
    
    // Current device info
    this.connectedDeviceId = null
    this.connectedDeviceName = null
    
    // Latest sensor data cache
    this.latestSensorData = null
  }

  /**
   * Initialize BLE - check support and availability
   */
  async init() {
    if (this.isInitialized) return { success: true }
    
    if (typeof uni !== 'undefined') {
      // uni-app native environment
      // uni-app has native BLE support via uni-ble-module
      this.platform = 'uni-app'
    } else if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      // Web Bluetooth
      this.platform = 'web'
    } else {
      // Simulate mode for development
      this.platform = 'mock'
      this.log('BLE: Running in mock mode (no real Bluetooth)')
    }
    
    this.isInitialized = true
    return { success: true, platform: this.platform }
  }

  /**
   * Check if Bluetooth is available
   */
  async checkAvailability() {
    if (this.platform === 'mock') {
      return { available: true, reason: 'Mock mode' }
    }
    if (this.platform === 'web') {
      try {
        const adapter = await navigator.bluetooth.getAvailability()
        return { available: adapter, reason: adapter ? '' : 'Bluetooth adapter not available' }
      } catch (e) {
        return { available: false, reason: e.message }
      }
    }
    if (this.platform === 'uni-app') {
      // uni-app: use uni.getSystemInfoSync to check
      return { available: true, reason: '' }
    }
    return { available: false, reason: 'Unknown platform' }
  }

  /**
   * Scan for ElderCare ESP32 devices
   */
  async scan() {
    if (this.isScanning) {
      this.log('BLE: Already scanning')
      return { success: false, reason: 'Already scanning' }
    }
    
    const availability = await this.checkAvailability()
    if (!availability.available) {
      return { success: false, reason: availability.reason }
    }
    
    this.isScanning = true
    this.log('BLE: Starting scan for devices...')
    
    try {
      if (this.platform === 'web') {
        return await this._scanWeb()
      } else if (this.platform === 'uni-app') {
        return await this._scanUniApp()
      } else {
        return await this._scanMock()
      }
    } finally {
      this.isScanning = false
      if (this.scanTimeoutTimer) {
        clearTimeout(this.scanTimeoutTimer)
        this.scanTimeoutTimer = null
      }
    }
  }

  async _scanWeb() {
    return new Promise((resolve, reject) => {
      this.scanTimeoutTimer = setTimeout(() => {
        if (this.isScanning) {
          navigator.bluetooth.cancelRequest().catch(() => {})
          this.isScanning = false
          resolve({ success: false, reason: 'Scan timeout', devices: [] })
        }
      }, SCAN_TIMEOUT_MS)

      navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
        optionalServices: [SERVICE_UUID]
      })
      .then(device => {
        clearTimeout(this.scanTimeoutTimer)
        this.isScanning = false
        resolve({
          success: true,
          devices: [{
            id: device.id,
            name: device.name || DEVICE_NAME_PREFIX,
            device: device
          }]
        })
      })
      .catch(err => {
        clearTimeout(this.scanTimeoutTimer)
        this.isScanning = false
        if (err.name === 'NotFoundError') {
          resolve({ success: false, reason: 'No device found', devices: [] })
        } else {
          resolve({ success: false, reason: err.message, devices: [] })
        }
      })
    })
  }

  async _scanUniApp() {
    // uni-app native BLE scanning
    // Note: In real implementation, use uni-ble or similar plugin
    // This is a simplified mock
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          devices: [
            {
              id: 'ESP32_A1B2C3',
              name: 'ElderCare_ESP32',
              deviceId: 'ESP32_A1B2C3'
            },
            {
              id: 'ESP32_D4E5F6',
              name: 'ElderCare_ESP32',
              deviceId: 'ESP32_D4E5F6'
            }
          ]
        })
      }, 2000)
    })
  }

  async _scanMock() {
    // Mock scan for development
    await new Promise(r => setTimeout(r, 1500))
    return {
      success: true,
      devices: [{
        id: 'mock-esp32-001',
        name: 'ElderCare_ESP32 (Mock)',
        mock: true
      }]
    }
  }

  /**
   * Connect to a device
   */
  async connect(deviceInfo) {
    if (this.isConnected) {
      this.log('BLE: Already connected, disconnecting first...')
      await this.disconnect()
    }
    
    this.log(`BLE: Connecting to ${deviceInfo.name} (${deviceInfo.id})...`)
    
    try {
      if (this.platform === 'web') {
        await this._connectWeb(deviceInfo.device)
      } else if (this.platform === 'uni-app') {
        await this._connectUniApp(deviceInfo)
      } else {
        await this._connectMock(deviceInfo)
      }
      
      this.isConnected = true
      this.connectedDeviceId = deviceInfo.id
      this.connectedDeviceName = deviceInfo.name
      this.reconnectAttempts = 0
      this.log(`BLE: Connected to ${deviceInfo.name}`)
      
      this._notifyConnectionChange(true)
      
      // Flush command queue
      await this._flushCommandQueue()
      
      return { success: true }
    } catch (err) {
      this.log(`BLE: Connection failed: ${err.message}`)
      this.isConnected = false
      this._notifyError(`连接失败: ${err.message}`)
      return { success: false, reason: err.message }
    }
  }

  async _connectWeb(nativeDevice) {
    this.device = nativeDevice
    
    // Connect to GATT server
    this.server = await nativeDevice.gatt.connect()
    
    // Get service
    this.service = await this.server.getPrimaryService(SERVICE_UUID)
    
    // Get characteristics
    this.txCharacteristic = await this.service.getCharacteristic(CHAR_RX_UUID)
    this.rxCharacteristic = await this.service.getCharacteristic(CHAR_TX_UUID)
    
    // Start notifications (listen for data from ESP32)
    await this.rxCharacteristic.startNotifications()
    this.rxCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      this._onBLEData(event.target.value)
    })
    
    // Monitor disconnect
    nativeDevice.addEventListener('gattserverdisconnected', () => {
      this._handleDisconnect()
    })
  }

  async _connectUniApp(deviceInfo) {
    // uni-app native BLE connection
    // Simplified mock implementation
    await new Promise(r => setTimeout(r, 1000))
    
    // Simulate connection
    this.device = { id: deviceInfo.id }
    this.service = { uuid: SERVICE_UUID }
    this.txCharacteristic = { uuid: CHAR_RX_UUID }
    this.rxCharacteristic = { uuid: CHAR_TX_UUID }
    
    // Simulate receiving data periodically
    this._startMockDataStream()
  }

  async _connectMock(deviceInfo) {
    await new Promise(r => setTimeout(r, 800))
    this.device = { id: deviceInfo.id, name: deviceInfo.name }
    
    // Simulate connected state with mock data
    this._startMockDataStream()
  }

  _startMockDataStream() {
    // Simulate ESP32 sending sensor data every 3 seconds
    this._mockInterval = setInterval(() => {
      if (!this.isConnected) {
        clearInterval(this._mockInterval)
        return
      }
      
      const mockData = this._generateMockSensorData()
      this._processReceivedData(mockData)
    }, 3000)
  }

  _generateMockSensorData() {
    const now = Math.floor(Date.now() / 1000)
    return {
      device_id: this.connectedDeviceId || 'ESP32_MOCK',
      timestamp: now,
      uptime_s: Math.floor(now % 86400),
      wifi_rssi: -45 - Math.floor(Math.random() * 20),
      fw_version: '1.0.0',
      sensors: {
        ld2450: {
          target_detected: Math.random() > 0.3,
          fall_detected: false,
          target_count: Math.random() > 0.5 ? 1 : 0,
          x_mm: Math.floor(Math.random() * 2000) - 1000,
          y_mm: Math.floor(Math.random() * 3000) + 500,
          speed_mm_s: Math.floor(Math.random() * 500)
        },
        smoke: {
          concentration: 50 + Math.floor(Math.random() * 100),
          alarm: Math.random() > 0.95,
          unit: 'ppm',
          raw_adc: 1500 + Math.floor(Math.random() * 500)
        },
        gas: {
          concentration: 30 + Math.floor(Math.random() * 80),
          alarm: Math.random() > 0.95,
          unit: 'ppm',
          raw_adc: 1200 + Math.floor(Math.random() * 400)
        },
        bracelet: {
          heart_rate: 65 + Math.floor(Math.random() * 30),
          blood_oxygen: 95 + Math.floor(Math.random() * 4),
          button_pressed: false,
          battery: 70 + Math.floor(Math.random() * 30),
          connected: true
        }
      }
    }
  }

  /**
   * Disconnect from current device
   */
  async disconnect() {
    this._clearReconnectTimer()
    if (this._mockInterval) {
      clearInterval(this._mockInterval)
      this._mockInterval = null
    }
    
    try {
      if (this.platform === 'web' && this.device) {
        if (this.device.gatt.connected) {
          this.device.gatt.disconnect()
        }
      }
    } catch (e) {
      this.log(`BLE: Disconnect error: ${e.message}`)
    }
    
    this.device = null
    this.server = null
    this.service = null
    this.txCharacteristic = null
    this.rxCharacteristic = null
    this.isConnected = false
    this.connectedDeviceId = null
    this.connectedDeviceName = null
    
    this._notifyConnectionChange(false)
    this.log('BLE: Disconnected')
  }

  _handleDisconnect() {
    this.isConnected = false
    this._notifyConnectionChange(false)
    this.log('BLE: Device disconnected')
    
    // Auto-reconnect
    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++
      this.log(`BLE: Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts})...`)
      this.reconnectTimer = setTimeout(() => {
        if (this.device && this.connectedDeviceName) {
          this.connect({ id: this.device.id, name: this.connectedDeviceName })
            .then(r => {
              if (!r.success) {
                this._handleDisconnect()
              }
            })
        }
      }, RECONNECT_DELAY_MS)
    }
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * Send a command to ESP32
   */
  async sendCommand(cmd, param = null) {
    let payload = { cmd }
    if (param !== null) {
      payload.param = param
    }
    const jsonStr = JSON.stringify(payload)
    
    this.log(`BLE TX: ${jsonStr}`)
    
    if (!this.isConnected) {
      // Queue command for later
      this.commandQueue.push(jsonStr)
      this.log('BLE: Not connected, command queued')
      return { success: false, reason: 'Not connected', queued: true }
    }
    
    try {
      if (this.platform === 'web') {
        const encoder = new TextEncoder()
        await this.txCharacteristic.writeValue(encoder.encode(jsonStr))
      } else {
        // Mock/uni-app: just log
        await new Promise(r => setTimeout(r, 100))
      }
      return { success: true }
    } catch (err) {
      this.log(`BLE TX error: ${err.message}`)
      return { success: false, reason: err.message }
    }
  }

  async _flushCommandQueue() {
    while (this.commandQueue.length > 0 && this.isConnected) {
      const cmd = this.commandQueue.shift()
      try {
        if (this.platform === 'web' && this.txCharacteristic) {
          const encoder = new TextEncoder()
          await this.txCharacteristic.writeValue(encoder.encode(cmd))
        }
        await new Promise(r => setTimeout(r, 50))
      } catch (e) {
        this.log(`Failed to flush queue: ${e.message}`)
        break
      }
    }
  }

  /**
   * Handle incoming BLE data
   */
  _onBLEData(value) {
    // value is a DataView or ArrayBuffer
    let str = ''
    if (typeof value === 'string') {
      str = value
    } else if (value instanceof DataView) {
      const decoder = new TextDecoder()
      str = decoder.decode(value.buffer)
    } else if (value instanceof ArrayBuffer) {
      const decoder = new TextDecoder()
      str = decoder.decode(value)
    }
    
    str = str.trim()
    if (!str) return
    
    this._processReceivedData(str)
  }

  _processReceivedData(rawData) {
    this.log(`BLE RX: ${rawData.substring(0, 100)}`)
    
    try {
      let data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData
      
      // Cache latest data
      this.latestSensorData = data
      
      // Notify callback
      if (this.onSensorData) {
        this.onSensorData(data)
      }
    } catch (e) {
      this.log(`BLE: Failed to parse data: ${e.message}, raw: ${rawData.substring(0, 50)}`)
    }
  }

  /**
   * Request current sensor status from device
   */
  async getStatus() {
    return await this.sendCommand('get_status')
  }

  /**
   * Get latest cached sensor data
   */
  getLatestData() {
    return this.latestSensorData
  }

  /**
   * Check WiFi status
   */
  async checkWiFiStatus() {
    return await this.sendCommand('wifi_status')
  }

  /**
   * Enable/disable HTTP reporting
   */
  async setHTTP(enabled) {
    return await this.sendCommand('set_http', enabled ? 'on' : 'off')
  }

  /**
   * Reboot device
   */
  async reboot() {
    return await this.sendCommand('reboot')
  }

  // ==================== Helpers ====================
  
  _notifyConnectionChange(connected) {
    if (this.onConnectionChange) {
      this.onConnectionChange(connected)
    }
  }

  _notifyError(message) {
    if (this.onError) {
      this.onError(message)
    }
  }

  log(message) {
    if (this.onLog) {
      this.onLog(message)
    }
    console.log(`[BLE Manager] ${message}`)
  }

  /**
   * Clean up
   */
  destroy() {
    this._clearReconnectTimer()
    if (this._mockInterval) {
      clearInterval(this._mockInterval)
    }
    this.disconnect()
    this.isInitialized = false
  }
}

// ==================== Sensor Data Parser ====================

/**
 * Parse raw BLE sensor data into a normalized format
 * for display in the app
 */
function parseSensorData(raw) {
  if (!raw) return null
  
  const now = Date.now()
  
  // Normalize device info
  const device = {
    id: raw.device_id || 'UNKNOWN',
    uptime_s: raw.uptime_s || 0,
    wifi_rssi: raw.wifi_rssi || -127,
    fw_version: raw.fw_version || '?',
    timestamp: raw.timestamp || Math.floor(now / 1000)
  }
  
  // Parse LD2450 radar
  const radar = raw.sensors?.ld2450 ? {
    targetDetected: !!raw.sensors.ld2450.target_detected,
    fallDetected: !!raw.sensors.ld2450.fall_detected,
    targetCount: raw.sensors.ld2450.target_count || 0,
    xMm: raw.sensors.ld2450.x_mm || 0,
    yMm: raw.sensors.ld2450.y_mm || 0,
    speedMmS: raw.sensors.ld2450.speed_mm_s || 0,
    // Human-readable distance
    distanceM: raw.sensors.ld2450.y_mm ? (raw.sensors.ld2450.y_mm / 1000).toFixed(1) + 'm' : '-',
    // Status text
    statusText: raw.sensors.ld2450.fall_detected ? '⚠️ 跌倒检测' :
                 raw.sensors.ld2450.target_detected ? '🟢 检测到人员' : '⚪ 无人员'
  } : null
  
  // Parse smoke sensor
  const smoke = raw.sensors?.smoke ? {
    concentration: raw.sensors.smoke.concentration_ppm || 0,
    alarm: !!raw.sensors.smoke.alarm,
    unit: raw.sensors.smoke.unit || 'ppm',
    rawAdc: raw.sensors.smoke.raw_adc || 0,
    statusText: raw.sensors.smoke.alarm ? '⚠️ 烟雾报警!' : '🟢 正常',
    alertLevel: raw.sensors.smoke.concentration_ppm > 300 ? 'danger' :
                raw.sensors.smoke.concentration_ppm > 150 ? 'warning' : 'normal'
  } : null
  
  // Parse gas sensor
  const gas = raw.sensors?.gas ? {
    concentration: raw.sensors.gas.concentration_ppm || 0,
    alarm: !!raw.sensors.gas.alarm,
    unit: raw.sensors.gas.unit || 'ppm',
    rawAdc: raw.sensors.gas.raw_adc || 0,
    statusText: raw.sensors.gas.alarm ? '⚠️ 燃气报警!' : '🟢 正常',
    alertLevel: raw.sensors.gas.concentration_ppm > 200 ? 'danger' :
                raw.sensors.gas.concentration_ppm > 100 ? 'warning' : 'normal'
  } : null
  
  // Parse bracelet
  const bracelet = raw.sensors?.bracelet ? {
    heartRate: raw.sensors.bracelet.heart_rate || 0,
    bloodOxygen: raw.sensors.bracelet.blood_oxygen || 0,
    buttonPressed: !!raw.sensors.bracelet.button_pressed,
    battery: raw.sensors.bracelet.battery_percent || 0,
    connected: !!raw.sensors.bracelet.bracelet_connected,
    statusText: raw.sensors.bracelet.button_pressed ? '⚠️ 求救按下!' :
                !raw.sensors.bracelet.bracelet_connected ? '⚠️ 手环断开' :
                '🟢 正常',
    alertLevel: raw.sensors.bracelet.button_pressed ? 'danger' :
                !raw.sensors.bracelet.bracelet_connected ? 'warning' :
                raw.sensors.bracelet.battery_percent < 20 ? 'warning' : 'normal'
  } : null
  
  // Overall system status
  const systemAlert = radar?.fallDetected || smoke?.alarm || gas?.alarm || bracelet?.buttonPressed
  
  return {
    device,
    radar,
    smoke,
    gas,
    bracelet,
    systemAlert,
    raw: raw
  }
}

// ==================== Export ====================

export { BLEManager, parseSensorData, SERVICE_UUID, CHAR_RX_UUID, CHAR_TX_UUID }
