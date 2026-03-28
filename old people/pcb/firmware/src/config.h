#ifndef CONFIG_H
#define CONFIG_H

// ==================== Hardware Pin Config ====================
// LD2420 24GHz mmWave Radar (UART)
#define PIN_LD2420_TX         17
#define PIN_LD2420_RX         16
#define LD2420_BAUD           256000

// MQ-2 Smoke Sensor (Analog)
#define PIN_MQ2_AO            34   // ADC1_CH6

// MQ-9 Gas Sensor (Analog)  
#define PIN_MQ9_AO            32   // ADC1_CH4

// Buzzer (active HIGH)
#define PIN_BUZZER            2

// Status LED (active HIGH)
#define PIN_LED_STATUS        4

// Status Bus (output from ESP32 to signaling device)
#define PIN_STATUS_WORK       14   // 工作状态指示
#define PIN_STATUS_ALARM       25   // 报警状态指示
#define PIN_STATUS_LOST        13   // 失联预警指示
#define PIN_STATUS_DATA        12   // 数据传输指示

// Phone Module UART (serial bridge to mobile)
#define PIN_PHONE_TX          27
#define PIN_PHONE_RX          26
#define PHONE_BAUD            9600

// ==================== BLE Config ====================
#define BLE_DEVICE_NAME       "ElderCare_ESP32"
#define BLE_SERVICE_UUID     "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define BLE_CHAR_RX_UUID     "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define BLE_CHAR_TX_UUID     "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// ==================== Thresholds ====================
#define SMOKE_ALARM_PPM       200
#define GAS_ALARM_PPM         150
#define MQ2_R0_KOHM           10
#define MQ9_R0_KOHM           10

// ==================== System ====================
#define SENSOR_READ_INTERVAL_MS  2000
#define SERIAL_BAUD             115200
#define FIRMWARE_VERSION        "1.1.0"
#define DEVICE_ID_PREFIX        "ESP32_"
#define WIFI_CONNECT_TIMEOUT_MS  15000
#define HTTP_POST_INTERVAL_MS   30000

#endif
