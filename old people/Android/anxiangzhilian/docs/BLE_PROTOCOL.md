# BLE 通信协议文档

## 概述

ElderCare ESP32 与手机 App 之间的蓝牙低功耗（BLE）通信协议。

- **BLE Service**: Nordic UART Service (NUS)
- **Service UUID**: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **TX Characteristic** (Phone → ESP32): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` (Write)
- **RX Characteristic** (ESP32 → Phone): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` (Notify)

## 传输格式

所有数据均为 **UTF-8 编码的 JSON 字符串**，最大长度建议不超过 512 字节。

---

## ESP32 → 手机（RX Characteristic Notify）

设备通过 BLE Notify 主动推送传感器数据，周期默认 **2 秒**。

### 完整数据帧

```json
{
  "device_id": "ESP32_A1B2C3",
  "timestamp": 1712000000,
  "uptime_s": 86400,
  "wifi_rssi": -45,
  "fw_version": "1.0.0",
  "sensors": {
    "ld2450": {
      "target_detected": true,
      "fall_detected": false,
      "target_count": 1,
      "x_mm": 500,
      "y_mm": 1500,
      "speed_mm_s": 120
    },
    "smoke": {
      "concentration": 120.5,
      "alarm": false,
      "unit": "ppm",
      "raw_adc": 2048
    },
    "gas": {
      "concentration": 85.0,
      "alarm": false,
      "unit": "ppm",
      "raw_adc": 1800
    },
    "bracelet": {
      "heart_rate": 72,
      "blood_oxygen": 98,
      "button_pressed": false,
      "battery": 85,
      "connected": true
    }
  }
}
```

### 字段说明

#### 顶层字段
| 字段 | 类型 | 说明 |
|------|------|------|
| `device_id` | string | 设备唯一ID，格式 `ESP32_XXXXXX`，由MAC地址生成 |
| `timestamp` | number | Unix 时间戳（秒），NTP未配置时为0 |
| `uptime_s` | number | 设备运行时间（秒） |
| `wifi_rssi` | number | WiFi信号强度（dBm），负数，-127表示未连接 |
| `fw_version` | string | 固件版本号 |

#### LD2450 毫米波雷达 (`sensors.ld2450`)
| 字段 | 类型 | 说明 |
|------|------|------|
| `target_detected` | bool | 是否检测到目标 |
| `fall_detected` | bool | 是否检测到跌倒（触发条件：近距离+高速运动后骤停） |
| `target_count` | number | 检测到的目标数量（0-3） |
| `x_mm` | number | 目标横向位置（mm），负数为左侧 |
| `y_mm` | number | 目标纵向距离（mm） |
| `speed_mm_s` | number | 目标移动速度（mm/s） |

#### 烟雾传感器 (`sensors.smoke`)
| 字段 | 类型 | 说明 |
|------|------|------|
| `concentration` | float | 烟雾浓度（ppm） |
| `alarm` | bool | 是否报警（超过阈值 SMOKE_ALARM_PPM=200） |
| `unit` | string | 单位，固定为 `"ppm"` |
| `raw_adc` | number | ADC 原始值（0-4095） |

#### 燃气传感器 (`sensors.gas`)
| 字段 | 类型 | 说明 |
|------|------|------|
| `concentration` | float | 燃气浓度（ppm） |
| `alarm` | bool | 是否报警（超过阈值 GAS_ALARM_PPM=150） |
| `unit` | string | 单位，固定为 `"ppm"` |
| `raw_adc` | number | ADC 原始值（0-4095） |

#### 智能手环 (`sensors.bracelet`)
| 字段 | 类型 | 说明 |
|------|------|------|
| `heart_rate` | number | 心率（BPM），0表示无数据 |
| `blood_oxygen` | number | 血氧饱和度（%），0表示无数据 |
| `button_pressed` | bool | 紧急按钮是否被按下 |
| `battery` | number | 手环电池电量（0-100%） |
| `connected` | bool | 手环与主控板的连接状态 |

---

## 手机 → ESP32（TX Characteristic Write）

手机通过 BLE Write 发送指令，ESP32 收到后执行相应操作。

### 指令格式

```json
{"cmd": "<command_name>", "param": "<optional_value>"}
```

### 支持的指令

| 指令 | 说明 | 示例 |
|------|------|------|
| `get_status` | 立即发送一次完整传感器数据 | `{"cmd": "get_status"}` |
| `wifi_status` | 查询WiFi连接状态，设备会回复 | `{"cmd": "wifi_status"}` |
| `set_http` | 开启/关闭HTTP数据上报 | `{"cmd": "set_http", "param": "on"}` 或 `"off"` |
| `version` | 查询固件版本 | `{"cmd": "version"}` |
| `reboot` | 重启ESP32设备 | `{"cmd": "reboot"}` |
| `set_wifi` | 设置WiFi SSID和密码 | `{"cmd": "set_wifi", "ssid": "MySSID", "pass": "MyPass"}` |

### 设备响应

设备收到指令后会通过 RX Characteristic 回复，格式同样为 JSON。

**wifi_status 响应示例：**
```json
{"cmd":"wifi_status","connected":true,"rssi":-45}
```

**version 响应示例：**
```json
{"cmd":"version","fw":"1.0.0"}
```

**错误响应：**
```json
{"cmd":"error","msg":"Unknown command"}
```

---

## 设备扫描与连接

### 扫描过滤

App 扫描时只显示名称以 `ElderCare_ESP32` 开头的 BLE 设备。

### 连接流程

1. App 调用 `navigator.bluetooth.requestDevice()`
2. 连接 GATT Server
3. 发现 Service `6E400001-...`
4. 获取 RX 和 TX Characteristic
5. 订阅 RX Characteristic 的 Notifications
6. 连接成功，开始接收数据

### 自动重连

连接断开后，App 会自动尝试重新连接，最多重试 3 次，间隔 3 秒。

---

## 数据解析（App端）

App 端请使用 `ble-manager.js` 中的 `parseSensorData()` 函数将原始 JSON 转换为结构化对象。

```javascript
import { BLEManager, parseSensorData } from '@/utils/ble-manager.js'

const ble = new BLEManager()
ble.onSensorData = (raw) => {
  const data = parseSensorData(raw)
  console.log(data.radar.statusText)  // "🟢 检测到人员"
  console.log(data.smoke.concentration)  // 120.5
  console.log(data.bracelet.heartRate)  // 72
  console.log(data.systemAlert)  // false
}
```

---

## 注意事项

1. BLE 传输速率有限，数据帧应尽量精简
2. 跌倒检测是基于简单运动学算法的近似判断，**不能替代专业医疗设备**
3. 烟雾/燃气阈值在 `config.h` 中可调整
4. WiFi RSSI 为负值，-50 表示信号很强，-90 表示信号很弱
5. 手环数据需要手环模块通过 UART 与 ESP32 通信才能获取
