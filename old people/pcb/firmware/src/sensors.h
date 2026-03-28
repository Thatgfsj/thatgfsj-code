#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

// ==================== LD2420 Radar ====================
typedef struct {
    bool target_detected;
    bool fall_detected;
    int16_t x_mm;
    int16_t y_mm;
    int16_t speed_mm_s;
    uint8_t target_count;
    uint8_t trigger_counter;
} LD2420Data;

void sensors_ld2420_begin();
void sensors_ld2420_read(LD2420Data* out);
bool sensors_ld2420_parse(const uint8_t* buf, size_t len, LD2420Data* out);

// ==================== Smoke (MQ-2) ====================
typedef struct {
    float concentration_ppm;
    bool alarm;
    uint16_t raw_adc;
} SmokeData;

void sensors_smoke_begin();
void sensors_smoke_read(SmokeData* out);

// ==================== Gas (MQ-9) ====================
typedef struct {
    float concentration_ppm;
    bool alarm;
    uint16_t raw_adc;
} GasData;

void sensors_gas_begin();
void sensors_gas_read(GasData* out);

// ==================== Phone Module ====================
typedef struct {
    bool button_pressed;
    uint8_t heart_rate;
    uint8_t blood_oxygen;
    uint8_t battery_percent;
    bool connected;
} PhoneData;

void sensors_phone_begin();
void sensors_phone_read(PhoneData* out);

// ==================== Actuators ====================
void sensors_actuators_begin();
void sensors_actuators_set(bool alarmActive, bool heartbeat);

// ==================== Combined Status ====================
typedef struct {
    LD2420Data radar;
    SmokeData smoke;
    GasData gas;
    PhoneData phone;
    unsigned long uptime_s;
    int8_t wifi_rssi;
} SensorStatus;

void sensors_begin();
void sensors_read_all(SensorStatus* out);

#endif
