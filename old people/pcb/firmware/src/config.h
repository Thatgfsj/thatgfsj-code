#ifndef CONFIG_H
#define CONFIG_H

// ==================== ESP32 Hardware Pin Config ====================
#define PIN_LD2450_TX         17
#define PIN_LD2450_RX         16
#define PIN_SMOKE_SENSOR      34   // ADC1_CH6
#define PIN_GAS_SENSOR        35   // ADC1_CH7
#define PIN_BRACELET_BUTTON   21   // GPIO, active LOW (pull-up)

// ==================== BLE Config ====================
#define BLE_DEVICE_NAME       "ElderCare_ESP32"
#define BLE_SERVICE_UUID     "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"  // Nordic UART Service
#define BLE_CHAR_RX_UUID     "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // TX (ESP32 sends)
#define BLE_CHAR_TX_UUID     "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // RX (ESP32 receives)

// ==================== WiFi Config ====================
// These will be stored in EEPROM/NVS or hardcoded for now
#define DEFAULT_WIFI_SSID     "YourWiFiSSID"
#define DEFAULT_WIFI_PASS     "YourWiFiPassword"
#define WIFI_CONNECT_TIMEOUT_MS 15000

// ==================== MQTT / HTTP Config ====================
#define DEFAULT_SERVER_HOST   "192.168.1.100"
#define DEFAULT_SERVER_PORT   8080
#define HTTP_POST_INTERVAL_MS 30000  // POST sensor data every 30s

// ==================== Sensor Thresholds ====================
#define SMOKE_ALARM_PPM       200   // ppm threshold for smoke alarm
#define GAS_ALARM_PPM         150   // ppm threshold for gas alarm
#define SMOKE_SENSOR_R0_KOHM  10    // Load resistance 10kΩ (adjust per sensor)
#define GAS_SENSOR_R0_KOHM    10

// ==================== System ====================
#define SENSOR_READ_INTERVAL_MS  2000  // 2 seconds
#define SERIAL_BAUD             115200
#define FIRMWARE_VERSION        "1.0.0"
#define DEVICE_ID_PREFIX        "ESP32_"

#endif // CONFIG_H
