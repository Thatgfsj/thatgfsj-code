<template>
  <view class="page-container">
    <!-- 顶部搜索栏 -->
    <view class="search-bar">
      <view class="search-wrapper">
        <text class="search-icon">🔍</text>
        <input class="search-input" placeholder="搜索设备..." v-model="keyword" />
      </view>
      <!-- BLE连接按钮 -->
      <view class="ble-status" @click="openBLESheet">
        <view class="ble-dot" :class="bleConnected ? 'connected' : 'disconnected'"></view>
        <text class="ble-label">{{ bleConnected ? '已连接' : '蓝牙' }}</text>
      </view>
      <button class="btn-add" @click="addDevice">+ 添加</button>
    </view>
    
    <!-- BLE实时设备信息 (当蓝牙已连接时显示) -->
    <view class="ble-device-panel" v-if="bleConnected && bleSensorData">
      <view class="panel-header">
        <text class="panel-title">📡 ESP32 传感器数据</text>
        <text class="panel-device-id">{{ bleSensorData.device?.id || bleDeviceId }}</text>
      </view>
      <view class="sensor-grid">
        <view class="sensor-cell" :class="{ alert: bleSensorData.radar?.fallDetected }">
          <text class="cell-icon">📡</text>
          <text class="cell-label">雷达</text>
          <text class="cell-value">{{ bleSensorData.radar?.statusText || '未知' }}</text>
        </view>
        <view class="sensor-cell" :class="{ alert: bleSensorData.smoke?.alarm }">
          <text class="cell-icon">🔥</text>
          <text class="cell-label">烟雾</text>
          <text class="cell-value">{{ bleSensorData.smoke?.concentration?.toFixed(0) || 0 }}ppm</text>
        </view>
        <view class="sensor-cell" :class="{ alert: bleSensorData.gas?.alarm }">
          <text class="cell-icon">⛽</text>
          <text class="cell-label">燃气</text>
          <text class="cell-value">{{ bleSensorData.gas?.concentration?.toFixed(0) || 0 }}ppm</text>
        </view>
        <view class="sensor-cell" :class="{ alert: bleSensorData.bracelet?.buttonPressed || bleSensorData.bracelet?.battery < 20 }">
          <text class="cell-icon">⌚</text>
          <text class="cell-label">手环</text>
          <text class="cell-value" v-if="bleSensorData.bracelet?.heartRate">{{ bleSensorData.bracelet.heartRate }}BPM</text>
          <text class="cell-value" v-else>--</text>
        </view>
      </view>
      <!-- 报警提示 -->
      <view class="alert-banner" v-if="bleSensorData.systemAlert">
        <text v-if="bleSensorData.radar?.fallDetected">⚠️ 跌倒检测告警!</text>
        <text v-else-if="bleSensorData.smoke?.alarm">⚠️ 烟雾浓度超标!</text>
        <text v-else-if="bleSensorData.gas?.alarm">⚠️ 燃气浓度超标!</text>
        <text v-else-if="bleSensorData.bracelet?.buttonPressed">⚠️ 紧急求救!</text>
      </view>
    </view>
    
    <!-- 设备类型筛选 -->
    <view class="filter-tabs">
      <view class="tab" :class="{active: typeFilter==='全部'}" @click="typeFilter='全部'">全部</view>
      <view class="tab" :class="{active: typeFilter==='LD2450'}" @click="typeFilter='LD2450'">LD2450雷达</view>
      <view class="tab" :class="{active: typeFilter==='手环'}" @click="typeFilter='手环'">智能手环</view>
      <view class="tab" :class="{active: typeFilter==='烟雾'}" @click="typeFilter='烟雾'">烟雾传感器</view>
      <view class="tab" :class="{active: typeFilter==='燃气'}" @click="typeFilter='燃气'">燃气传感器</view>
    </view>
    
    <!-- 设备列表 -->
    <view class="device-list">
      <view class="device-card" v-for="item in filteredList" :key="item.id">
        <view class="device-icon">
          <text>{{ getTypeIcon(item.device_type) }}</text>
        </view>
        <view class="device-info">
          <view class="device-header">
            <text class="device-name">{{ item.device_name }}</text>
            <view class="status-badge" :class="item.bind_status === '已绑定' ? 'bound' : 'unbound'">
              {{ item.bind_status }}
            </view>
          </view>
          <view class="device-detail">
            <text class="detail-item">编号: {{ item.device_no }}</text>
            <text class="detail-item">类型: {{ item.device_type }}</text>
            <text class="detail-item">通道: {{ item.channel }}</text>
          </view>
        </view>
        <!-- BLE数据覆盖显示(如果已连接且匹配) -->
        <view class="device-ble-overlay" v-if="isBLEDevice(item) && bleSensorData">
          <view class="ble-overlay-data">
            <text class="ble-overlay-item" v-if="item.device_type === 'LD2450'">
              {{ bleSensorData.radar?.statusText }}
            </text>
            <text class="ble-overlay-item" v-if="item.device_type === '烟雾'">
              {{ bleSensorData.smoke?.concentration?.toFixed(1) }}ppm
            </text>
            <text class="ble-overlay-item" v-if="item.device_type === '燃气'">
              {{ bleSensorData.gas?.concentration?.toFixed(1) }}ppm
            </text>
            <text class="ble-overlay-item" v-if="item.device_type === '手环'">
              ❤️ {{ bleSensorData.bracelet?.heartRate || '--' }}BPM
              🩸 {{ bleSensorData.bracelet?.bloodOxygen || '--' }}%
            </text>
          </view>
        </view>
      </view>
    </view>
    
    <!-- BLE连接Sheet -->
    <BLEConnectSheet v-if="showBLESheet" @close="showBLESheet = false" />
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { BLEManager, parseSensorData } from '../../utils/ble-manager.js'
import BLEConnectSheet from './components/ble-connect-sheet.vue'

const keyword = ref('')
const typeFilter = ref('全部')
const showBLESheet = ref(false)
const bleConnected = ref(false)
const bleDeviceId = ref('')
const bleSensorData = ref(null)

// BLE Manager instance (singleton)
let bleManager = null

// 模拟设备列表 (原有静态数据)
const list = ref([
  { id: 1, device_no: 'DEV-001', device_name: '智能手环A1', device_type: '手环', channel: 'CH-01', bind_status: '已绑定' },
  { id: 2, device_no: 'DEV-002', device_name: '紧急呼叫器B2', device_type: '手环', channel: 'CH-02', bind_status: '已绑定' },
  { id: 3, device_no: 'DEV-003', device_name: 'LD2450毫米波雷达', device_type: 'LD2450', channel: 'CH-03', bind_status: '已绑定' },
  { id: 4, device_no: 'DEV-004', device_name: '烟雾传感器', device_type: '烟雾', channel: 'CH-04', bind_status: '已绑定' },
  { id: 5, device_no: 'DEV-005', device_name: '燃气传感器', device_type: '燃气', channel: 'CH-05', bind_status: '已绑定' }
])

const filteredList = computed(() => {
  let result = list.value
  if (typeFilter.value !== '全部') {
    result = result.filter(item => item.device_type === typeFilter.value)
  }
  if (keyword.value) {
    result = result.filter(item => item.device_name.includes(keyword.value) || item.device_no.includes(keyword.value))
  }
  return result
})

const getTypeIcon = (type) => {
  const icons = { 'LD2450': '📡', '手环': '⌚', '烟雾': '🔥', '燃气': '⛽' }
  return icons[type] || '📱'
}

// 判断设备是否是BLE设备(通过名称或类型匹配)
const isBLEDevice = (item) => {
  if (!bleSensorData.value) return false
  // 所有传感器类型都可能通过BLE连接
  const bleTypes = ['LD2450', '手环', '烟雾', '燃气']
  return bleTypes.includes(item.device_type)
}

// 打开BLE连接Sheet
const openBLESheet = () => {
  showBLESheet.value = true
}

// 初始化BLE
onMounted(async () => {
  bleManager = new BLEManager()
  await bleManager.init()
  
  // 设置回调
  bleManager.onConnectionChange = (connected) => {
    bleConnected.value = connected
    if (connected) {
      bleDeviceId.value = bleManager.connectedDeviceId || ''
    } else {
      bleDeviceId.value = ''
      bleSensorData.value = null
    }
  }
  
  bleManager.onSensorData = (data) => {
    bleSensorData.value = parseSensorData(data)
  }
  
  // 检查是否已有连接
  bleConnected.value = bleManager.isConnected
  if (bleConnected.value) {
    bleDeviceId.value = bleManager.connectedDeviceId || ''
  }
})

onUnmounted(() => {
  if (bleManager) {
    bleManager.destroy()
  }
})

const addDevice = () => {
  uni.showToast({ title: '添加设备功能开发中', icon: 'none' })
}
</script>

<style scoped>
.page-container {
  min-height: 100vh;
  background: linear-gradient(180deg, #f7fafc 0%, #edf2f7 100%);
  padding: 20rpx;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 30rpx;
}

.search-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 16rpx;
  padding: 0 24rpx;
  height: 80rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.04);
}

.search-icon {
  font-size: 32rpx;
  margin-right: 16rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
}

.ble-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8rpx 16rpx;
  background: #fff;
  border-radius: 12rpx;
  min-width: 80rpx;
}

.ble-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-bottom: 4rpx;
}

.ble-dot.connected {
  background: #48bb78;
  box-shadow: 0 0 8rpx #48bb78;
}

.ble-dot.disconnected {
  background: #e53e3e;
}

.ble-label {
  font-size: 20rpx;
  color: #718096;
}

.btn-add {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: #fff;
  border: none;
  padding: 0 28rpx;
  height: 80rpx;
  border-radius: 16rpx;
  font-size: 28rpx;
  box-shadow: 0 4rpx 12rpx rgba(245, 87, 108, 0.4);
}

/* BLE Device Panel */
.ble-device-panel {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.06);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.panel-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #2d3748;
}

.panel-device-id {
  font-size: 22rpx;
  color: #a0aec0;
  font-family: monospace;
}

.sensor-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;
}

.sensor-cell {
  background: #f7fafc;
  border-radius: 16rpx;
  padding: 16rpx 12rpx;
  text-align: center;
}

.sensor-cell.alert {
  background: #fff5f5;
}

.cell-icon {
  font-size: 40rpx;
  display: block;
  margin-bottom: 8rpx;
}

.cell-label {
  font-size: 22rpx;
  color: #718096;
  display: block;
  margin-bottom: 4rpx;
}

.cell-value {
  font-size: 24rpx;
  font-weight: 600;
  color: #2d3748;
  display: block;
}

.alert-banner {
  margin-top: 16rpx;
  background: linear-gradient(135deg, #fed7d7, #feb2b2);
  color: #c53030;
  text-align: center;
  padding: 16rpx;
  border-radius: 12rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.filter-tabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 20rpx;
  overflow-x: auto;
}

.tab {
  padding: 12rpx 24rpx;
  background: #fff;
  border-radius: 30rpx;
  font-size: 24rpx;
  white-space: nowrap;
}

.tab.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.device-card {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 20rpx;
  padding: 30rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
  position: relative;
  overflow: hidden;
}

.device-icon {
  width: 100rpx;
  height: 100rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
  font-size: 48rpx;
}

.device-info {
  flex: 1;
}

.device-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.device-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #2d3748;
}

.status-badge {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  font-size: 24rpx;
}

.status-badge.bound {
  background: linear-gradient(135deg, #c6f6d5 0%, #9ae6b4 100%);
  color: #22543d;
}

.status-badge.unbound {
  background: linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%);
  color: #742a2a;
}

.device-detail {
  display: flex;
  gap: 30rpx;
}

.detail-item {
  font-size: 24rpx;
  color: #718096;
}

/* BLE overlay on device card */
.device-ble-overlay {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(102, 126, 234, 0.08);
  border-left: 2rpx dashed rgba(102, 126, 234, 0.3);
  padding: 0 20rpx;
  display: flex;
  align-items: center;
}

.ble-overlay-data {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.ble-overlay-item {
  font-size: 22rpx;
  color: #667eea;
  font-weight: 500;
}
</style>
