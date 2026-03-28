<template>
  <view class="ble-sheet" v-if="visible">
    <!-- Backdrop -->
    <view class="backdrop" @click="close"></view>
    
    <!-- Sheet -->
    <view class="sheet">
      <view class="sheet-header">
        <text class="sheet-title">{{ isConnected ? '蓝牙已连接' : '连接设备' }}</text>
        <text class="close-btn" @click="close">✕</text>
      </view>
      
      <!-- Connection Status -->
      <view class="connection-status" v-if="isConnected">
        <view class="status-dot connected"></view>
        <view class="status-info">
          <text class="device-name">{{ deviceName }}</text>
          <text class="device-id">ID: {{ deviceId }}</text>
        </view>
        <button class="btn-disconnect" @click="disconnect">断开</button>
      </view>
      
      <!-- Not Connected: Scan -->
      <view v-if="!isConnected">
        <!-- Connection Error -->
        <view class="error-box" v-if="errorMsg">
          <text>⚠️ {{ errorMsg }}</text>
        </view>
        
        <!-- Scan Button -->
        <button class="btn-scan" v-if="!isScanning" @click="startScan">
          🔍 扫描设备
        </button>
        
        <view class="scanning" v-if="isScanning">
          <view class="spinner"></view>
          <text>扫描中...</text>
        </view>
        
        <!-- Device List -->
        <view class="device-list" v-if="devices.length > 0">
          <view 
            class="device-item" 
            v-for="d in devices" 
            :key="d.id"
            @click="connectTo(d)"
          >
            <view class="device-icon">📡</view>
            <view class="device-info">
              <text class="device-item-name">{{ d.name }}</text>
              <text class="device-item-id">ID: {{ d.id }}</text>
            </view>
            <text class="signal">{{ d.mock ? '📶' : '📶' }}</text>
          </view>
        </view>
        
        <!-- Log -->
        <view class="log-box" v-if="logs.length > 0">
          <text class="log-title">连接日志:</text>
          <scroll-view scroll-y class="log-scroll">
            <text v-for="(log, i) in logs" :key="i" class="log-line">{{ log }}</text>
          </scroll-view>
        </view>
      </view>
      
      <!-- Connected: Sensor Overview -->
      <view class="sensor-overview" v-if="isConnected && sensorData">
        <text class="section-title">传感器状态</text>
        
        <!-- LD2450 Radar -->
        <view class="sensor-card radar" :class="{ alert: sensorData.radar?.fallDetected }">
          <view class="sensor-header">
            <text class="sensor-icon">📡</text>
            <text class="sensor-name">LD2450 毫米波雷达</text>
          </view>
          <view class="sensor-body">
            <view class="sensor-row">
              <text class="row-label">状态</text>
              <text class="row-value">{{ sensorData.radar?.statusText || '未知' }}</text>
            </view>
            <view class="sensor-row" v-if="sensorData.radar?.targetDetected">
              <text class="row-label">距离</text>
              <text class="row-value">{{ sensorData.radar?.distanceM }}</text>
            </view>
            <view class="sensor-row">
              <text class="row-label">目标数</text>
              <text class="row-value">{{ sensorData.radar?.targetCount }}</text>
            </view>
            <view class="sensor-row" v-if="sensorData.radar?.fallDetected">
              <text class="row-value alert-text">⚠️ 跌倒检测!</text>
            </view>
          </view>
        </view>
        
        <!-- Smoke -->
        <view class="sensor-card smoke" :class="{ alert: sensorData.smoke?.alarm }">
          <view class="sensor-header">
            <text class="sensor-icon">🔥</text>
            <text class="sensor-name">烟雾传感器</text>
          </view>
          <view class="sensor-body">
            <view class="sensor-row">
              <text class="row-label">浓度</text>
              <text class="row-value">{{ sensorData.smoke?.concentration?.toFixed(1) }} ppm</text>
            </view>
            <view class="sensor-row">
              <text class="row-label">状态</text>
              <text class="row-value" :class="{ 'alert-text': sensorData.smoke?.alarm }">
                {{ sensorData.smoke?.statusText }}
              </text>
            </view>
          </view>
        </view>
        
        <!-- Gas -->
        <view class="sensor-card gas" :class="{ alert: sensorData.gas?.alarm }">
          <view class="sensor-header">
            <text class="sensor-icon">⛽</text>
            <text class="sensor-name">燃气传感器</text>
          </view>
          <view class="sensor-body">
            <view class="sensor-row">
              <text class="row-label">浓度</text>
              <text class="row-value">{{ sensorData.gas?.concentration?.toFixed(1) }} ppm</text>
            </view>
            <view class="sensor-row">
              <text class="row-label">状态</text>
              <text class="row-value" :class="{ 'alert-text': sensorData.gas?.alarm }">
                {{ sensorData.gas?.statusText }}
              </text>
            </view>
          </view>
        </view>
        
        <!-- Bracelet -->
        <view class="sensor-card bracelet" :class="{ alert: sensorData.bracelet?.buttonPressed }">
          <view class="sensor-header">
            <text class="sensor-icon">⌚</text>
            <text class="sensor-name">智能手环</text>
          </view>
          <view class="sensor-body">
            <view class="sensor-row">
              <text class="row-label">心率</text>
              <text class="row-value">{{ sensorData.bracelet?.heartRate || '--' }} BPM</text>
            </view>
            <view class="sensor-row">
              <text class="row-label">血氧</text>
              <text class="row-value">{{ sensorData.bracelet?.bloodOxygen || '--' }}%</text>
            </view>
            <view class="sensor-row">
              <text class="row-label">电量</text>
              <text class="row-value">🔋 {{ sensorData.bracelet?.battery || 0 }}%</text>
            </view>
            <view class="sensor-row">
              <text class="row-label">状态</text>
              <text class="row-value" :class="{ 'alert-text': sensorData.bracelet?.buttonPressed }">
                {{ sensorData.bracelet?.statusText }}
              </text>
            </view>
          </view>
        </view>
        
        <!-- System Info -->
        <view class="system-info">
          <view class="sys-row">
            <text class="row-label">在线时间</text>
            <text class="row-value">{{ formatUptime(sensorData.device?.uptime_s) }}</text>
          </view>
          <view class="sys-row">
            <text class="row-label">WiFi信号</text>
            <text class="row-value">{{ sensorData.device?.wifi_rssi }} dBm</text>
          </view>
          <view class="sys-row">
            <text class="row-label">固件版本</text>
            <text class="row-value">v{{ sensorData.device?.fw_version }}</text>
          </view>
        </view>
        
        <!-- Actions -->
        <view class="actions">
          <button class="btn-action" @click="refreshData">🔄 刷新数据</button>
          <button class="btn-action" @click="checkWiFi">📶 WiFi状态</button>
        </view>
      </view>
      
      <!-- No data yet -->
      <view class="no-data" v-if="isConnected && !sensorData">
        <text>等待数据...</text>
        <button class="btn-action" @click="refreshData">🔄 刷新数据</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { BLEManager, parseSensorData } from '../../utils/ble-manager.js'

const emit = defineEmits(['close'])

// BLE Manager instance
let ble = null

// UI State
const visible = ref(true)
const isConnected = ref(false)
const isScanning = ref(false)
const deviceId = ref('')
const deviceName = ref('')
const devices = ref([])
const errorMsg = ref('')
const logs = ref([])
const sensorData = ref(null)

// Format uptime
function formatUptime(seconds) {
  if (!seconds) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// Logging
function addLog(msg) {
  const ts = new Date().toLocaleTimeString()
  logs.value.unshift(`[${ts}] ${msg}`)
  if (logs.value.length > 20) logs.value.pop()
}

// BLE Callbacks
function onSensorData(data) {
  sensorData.value = parseSensorData(data)
  addLog(`数据更新: ${sensorData.value.device?.id}`)
}

function onConnectionChange(connected) {
  isConnected.value = connected
  if (!connected) {
    deviceId.value = ''
    deviceName.value = ''
    sensorData.value = null
  }
}

function onError(msg) {
  errorMsg.value = msg
  addLog(`错误: ${msg}`)
  setTimeout(() => { errorMsg.value = '' }, 5000)
}

// Actions
async function startScan() {
  errorMsg.value = ''
  logs.value = []
  devices.value = []
  isScanning.value = true
  addLog('开始扫描...')
  
  const result = await ble.scan()
  
  isScanning.value = false
  
  if (result.success && result.devices.length > 0) {
    devices.value = result.devices
    addLog(`找到 ${result.devices.length} 个设备`)
  } else {
    errorMsg.value = result.reason || '未找到设备'
    addLog('扫描结束: ' + (result.reason || '无设备'))
  }
}

async function connectTo(d) {
  addLog(`正在连接 ${d.name}...`)
  const result = await ble.connect(d)
  if (result.success) {
    deviceId.value = d.id
    deviceName.value = d.name
    addLog('连接成功!')
  } else {
    errorMsg.value = result.reason
    addLog('连接失败: ' + result.reason)
  }
}

async function disconnect() {
  addLog('断开连接...')
  await ble.disconnect()
  isConnected.value = false
  deviceId.value = ''
  deviceName.value = ''
  sensorData.value = null
}

function close() {
  visible.value = false
  emit('close')
}

async function refreshData() {
  await ble.getStatus()
  addLog('已请求数据刷新')
}

async function checkWiFi() {
  await ble.checkWiFiStatus()
  addLog('已请求WiFi状态')
}

// Lifecycle
onMounted(async () => {
  ble = new BLEManager()
  await ble.init()
  
  ble.onSensorData = onSensorData
  ble.onConnectionChange = onConnectionChange
  ble.onError = onError
  ble.onLog = addLog
  
  // Check if already connected
  if (ble.isConnected) {
    isConnected.value = true
    deviceId.value = ble.connectedDeviceId || ''
    deviceName.value = ble.connectedDeviceName || ''
  }
})

onUnmounted(() => {
  if (ble) {
    ble.destroy()
  }
})
</script>

<style scoped>
.ble-sheet {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  display: flex;
  align-items: flex-end;
}

.backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
}

.sheet {
  position: relative;
  width: 100%;
  max-height: 85vh;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  padding: 32rpx;
  overflow-y: auto;
}

.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32rpx;
}

.sheet-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #1a202c;
}

.close-btn {
  font-size: 40rpx;
  color: #999;
  padding: 8rpx 16rpx;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
  background: linear-gradient(135deg, #c6f6d5, #9ae6b4);
  border-radius: 20rpx;
  margin-bottom: 24rpx;
}

.status-dot {
  width: 24rpx;
  height: 24rpx;
  border-radius: 50%;
  background: #48bb78;
}

.status-dot.connected {
  background: #48bb78;
  box-shadow: 0 0 12rpx #48bb78;
}

.status-info {
  flex: 1;
}

.device-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #22543d;
  display: block;
}

.device-id {
  font-size: 24rpx;
  color: #276749;
}

.btn-disconnect {
  background: #fff;
  color: #e53e3e;
  border: 2rpx solid #e53e3e;
  font-size: 26rpx;
  padding: 12rpx 24rpx;
  border-radius: 30rpx;
}

.error-box {
  background: #fed7d7;
  color: #c53030;
  padding: 20rpx;
  border-radius: 12rpx;
  font-size: 28rpx;
  margin-bottom: 20rpx;
}

.btn-scan {
  width: 100%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  padding: 28rpx;
  border-radius: 20rpx;
  font-size: 32rpx;
  font-weight: 600;
}

.scanning {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  padding: 40rpx;
  color: #667eea;
  font-size: 30rpx;
}

.spinner {
  width: 40rpx;
  height: 40rpx;
  border: 4rpx solid #667eea;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.device-list {
  margin-top: 24rpx;
}

.device-item {
  display: flex;
  align-items: center;
  padding: 24rpx;
  background: #f7fafc;
  border-radius: 16rpx;
  margin-bottom: 12rpx;
}

.device-icon {
  font-size: 48rpx;
  margin-right: 20rpx;
}

.device-info {
  flex: 1;
}

.device-item-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #2d3748;
  display: block;
}

.device-item-id {
  font-size: 24rpx;
  color: #718096;
}

.log-box {
  margin-top: 24rpx;
  background: #1a202c;
  border-radius: 12rpx;
  padding: 16rpx;
}

.log-title {
  color: #718096;
  font-size: 24rpx;
  display: block;
  margin-bottom: 8rpx;
}

.log-scroll {
  max-height: 200rpx;
}

.log-line {
  color: #68d391;
  font-size: 22rpx;
  font-family: monospace;
  display: block;
  line-height: 1.6;
}

/* Sensor Overview */
.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #2d3748;
  margin-bottom: 20rpx;
  display: block;
}

.sensor-card {
  background: #f7fafc;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 16rpx;
  border-left: 6rpx solid #cbd5e0;
}

.sensor-card.radar { border-left-color: #667eea; }
.sensor-card.smoke { border-left-color: #f56565; }
.sensor-card.gas { border-left-color: #ed8936; }
.sensor-card.bracelet { border-left-color: #38b2ac; }

.sensor-card.alert {
  background: #fff5f5;
  border-left-color: #e53e3e;
}

.sensor-header {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

.sensor-icon {
  font-size: 36rpx;
}

.sensor-name {
  font-size: 28rpx;
  font-weight: 600;
  color: #2d3748;
}

.sensor-body {
  padding-left: 48rpx;
}

.sensor-row {
  display: flex;
  justify-content: space-between;
  padding: 6rpx 0;
}

.row-label {
  font-size: 26rpx;
  color: #718096;
}

.row-value {
  font-size: 26rpx;
  color: #2d3748;
  font-weight: 500;
}

.alert-text {
  color: #e53e3e !important;
}

.system-info {
  background: #edf2f7;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
  margin: 20rpx 0;
}

.sys-row {
  display: flex;
  justify-content: space-between;
  padding: 6rpx 0;
}

.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.btn-action {
  flex: 1;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  padding: 20rpx;
  border-radius: 16rpx;
  font-size: 28rpx;
}

.no-data {
  text-align: center;
  padding: 60rpx;
  color: #718096;
  font-size: 28rpx;
}
</style>
