#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

// ==================== LD2450 Radar ====================
// LD2450 is a 24GHz mmWave human detection radar with UART output.
// Default baud: 256000, 8N1. Protocol is custom but simple.
//
// Simplified protocol frame (target tracking mode):
//   Header: 0xAA 0xFF 0x03 [len] [data...] [checksum]
//   Data contains: target count (0-3), and for each target:
//     - X, Y, Z coordinates (in mm)
//     - Speed (mm/s)
//     - Detection flag
//
// We will parse what we can and provide a clean struct.

#define LD2450_BAUD 256000
#define LD2450_FRAME_SIZE 32

typedef struct {
    bool target_detected;
    bool fall_detected;
    int16_t x_mm;        // lateral distance
    int16_t y_mm;        // forward distance
    int16_t z_mm;        // height (optional)
    int16_t speed_mm_s;
    uint8_t target_count;
    uint8_t trigger_counter;  // consecutive detections for fall algorithm
} LD2450Data;

void sensors_ld2450_begin();
void sensors_ld2450_read(LD2450Data* out);
bool sensors_ld2450_parse(const uint8_t* buf, size_t len, LD2450Data* out);

// ==================== Smoke Sensor ====================
// MQ-2 / MQ-135 type analog gas sensor.
// VRL = (ADC / 4095) * 3.3V
// RS = (3.3V - VRL) / VRL * RL (load resistor)
// ratio = RS / R0
// For smoke: concentration = a * (ratio ^ b)
// We'll use a simplified linear mapping for demonstration.

typedef struct {
    float concentration_ppm;
    bool alarm;
    uint16_t raw_adc;
} SmokeData;

void sensors_smoke_begin();
void sensors_smoke_read(SmokeData* out);

// ==================== Gas Sensor ====================
// Same family as smoke sensor, different gas type.
// Using configurable threshold.

typedef struct {
    float concentration_ppm;
    bool alarm;
    uint16_t raw_adc;
} GasData;

void sensors_gas_begin();
void sensors_gas_read(GasData* out);

// ==================== Bracelet (Emergency Button + Health) ====================
// The bracelet has a physical button (active LOW with internal pull-up).
// Health data (heart rate, SpO2) is received via UART from the bracelet module.

typedef struct {
    bool button_pressed;       // true = emergency alarm triggered
    uint8_t heart_rate;       // BPM, 0 if not available
    uint8_t blood_oxygen;     // SpO2 %, 0 if not available
    uint8_t battery_percent;  // 0-100
    bool bracelet_connected;  // UART data received recently
} BraceletData;

void sensors_bracelet_begin();
void sensors_bracelet_read(BraceletData* out);
void sensors_bracelet_parse_uart(const uint8_t* data, size_t len);

// ==================== Combined Status ====================
typedef struct {
    LD2450Data ld2450;
    SmokeData smoke;
    GasData gas;
    BraceletData bracelet;
    unsigned long uptime_s;
    int8_t wifi_rssi;
} SensorStatus;

void sensors_begin();
void sensors_read_all(SensorStatus* out);
void sensors_update_uptime();

// ==================== Utility ====================
uint16_t read_adc_smooth(int pin, int samples = 16);

#endif // SENSORS_H
