# ElderCare ESP32 固件

ESP32 多传感器养老监护设备固件。

## 硬件连接

| 传感器/模块 | 引脚 | 说明 |
|-----------|------|------|
| LD2450 毫米波雷达 | TX=17, RX=16 | UART 通信，波特率 256000 |
| 烟雾传感器 (MQ-2/135) | GPIO34 (ADC) | 模拟电压输出 |
| 燃气传感器 | GPIO35 (ADC) | 模拟电压输出 |
| 智能手环 (UART) | GPIO26(RX), GPIO27(TX) | 波特率 9600 |
| 紧急按钮 | GPIO21 | 低电平有效 (上拉) |
| 板载 LED | GPIO2 | 状态指示 |

## 功能特性

- **LD2450 毫米波雷达**：人体检测 + 跌倒检测算法
- **烟雾/燃气报警**：阈值可配置
- **智能手环**：心率、血氧、电池、一键报警
- **BLE 广播**：Nordic UART Service，兼容手机App
- **WiFi + HTTP POST**：可选，将数据上报到服务器

## 快速开始

### 1. 安装 PlatformIO

```bash
pip install platformio
```

### 2. 配置 WiFi（可选）

通过 BLE 或串口配置：

```bash
# 串口命令
wifi YourSSID YourPassword
```

BLE 命令格式：
```json
{"cmd": "set_wifi", "ssid": "YourSSID", "pass": "YourPassword"}
```

### 3. 编译上传

```bash
cd firmware
pio run --target upload
pio device monitor
```

## BLE 数据格式

设备通过 BLE Notify 推送 JSON 数据：

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

## BLE 指令

手机可通过 BLE Write 发送命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `get_status` | 立即获取传感器数据 | `{"cmd": "get_status"}` |
| `wifi_status` | 查询 WiFi 连接状态 | `{"cmd": "wifi_status"}` |
| `set_http` | 开启/关闭 HTTP 上报 | `{"cmd": "set_http", "param": "on"}` |
| `version` | 查询固件版本 | `{"cmd": "version"}` |
| `reboot` | 重启设备 | `{"cmd": "reboot"}` |

## 串口命令

连接 ESP32 串口（115200 波特率）后可使用以下命令：

- `status` - 打印当前传感器状态
- `wifi <ssid> <pass>` - 设置并连接 WiFi
- `wifi on/off` - 开启/关闭 WiFi
- `reboot` - 重启
- `version` - 显示版本
- `help` - 帮助

## HTTP API

当 WiFi 和 HTTP 上报开启时，每 30 秒 POST 数据到：

```
POST http://<server_host>:<port>/api/sensor-data
Headers: Content-Type: application/json, X-Device-ID: <device_id>
Body: 同 BLE JSON 格式
```

## 依赖

- [ArduinoJson v6](https://arduinojson.org/) - JSON 序列化
- ESP32 Arduino Core (内置 BLE/WiFi/ADC)
