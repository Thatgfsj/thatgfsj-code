#include "config.h"
#include "sensors.h"
#include <driver/adc.h>

// ==================== LD2420 Radar ====================
static HardwareSerial LD2420Serial(1);  // UART1 on GPIO16/17

void sensors_ld2420_begin() {
    LD2420Serial.begin(LD2420_BAUD, SERIAL_8N1, PIN_LD2420_RX, PIN_LD2420_TX);
}

bool sensors_ld2420_parse(const uint8_t* buf, size_t len, LD2420Data* out) {
    // LD2420 protocol: header 0xAA 0xFF 0x03 [len] [data...] [checksum]
    if (len < 8) return false;

    for (size_t i = 0; i < len - 3; i++) {
        if (buf[i] == 0xAA && buf[i+1] == 0xFF && buf[i+2] == 0x03) {
            uint8_t dataLen = buf[i+3];
            if (i + 3 + dataLen + 1 > len) return false;

            uint8_t targetCount = buf[i+4];
            out->target_count = targetCount;

            if (targetCount > 0 && targetCount <= 3) {
                size_t base = i + 5;
                out->target_detected = (buf[base] & 0x01) != 0;
                out->x_mm = (int16_t)(buf[base+1] | (buf[base+2] << 8));
                out->y_mm = (int16_t)(buf[base+3] | (buf[base+4] << 8));
                out->speed_mm_s = (int16_t)(buf[base+5] | (buf[base+6] << 8));

                // Simple fall detection: close distance + high speed → sudden stop
                static int16_t lastY = 0;
                static unsigned long lastFallCheck = 0;
                unsigned long now = millis();
                if (now - lastFallCheck > 500) {
                    if (out->y_mm < 1000 && abs(out->speed_mm_s) > 800) {
                        out->trigger_counter++;
                        if (out->trigger_counter >= 3) out->fall_detected = true;
                    } else {
                        out->trigger_counter = 0;
                        out->fall_detected = false;
                    }
                    lastY = out->y_mm;
                    lastFallCheck = now;
                }
            } else {
                out->target_detected = false;
                out->fall_detected = false;
                out->trigger_counter = 0;
            }
            return true;
        }
    }
    return false;
}

void sensors_ld2420_read(LD2420Data* out) {
    memset(out, 0, sizeof(LD2420Data));
    if (LD2420Serial.available()) {
        static uint8_t buf[64];
        static size_t bufLen = 0;
        while (LD2420Serial.available() && bufLen < sizeof(buf)) {
            buf[bufLen++] = LD2420Serial.read();
        }
        if (sensors_ld2420_parse(buf, bufLen, out)) bufLen = 0;
        if (bufLen > 30) bufLen = 0;
    }
}

// ==================== ADC ====================
static bool adcInitDone = false;

static void ensure_adc_init() {
    if (adcInitDone) return;
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(ADC1_CHANNEL_6, ADC_ATTEN_DB_12);  // GPIO34
    adc1_config_channel_atten(ADC1_CHANNEL_4, ADC_ATTEN_DB_12); // GPIO32
    adcInitDone = true;
}

static uint16_t read_adc_smooth(adc1_channel_t ch, int samples = 16) {
    ensure_adc_init();
    int sum = 0;
    for (int i = 0; i < samples; i++) {
        sum += adc1_get_raw(ch);
        delayMicroseconds(100);
    }
    return sum / samples;
}

// ==================== Smoke (MQ-2) ====================
void sensors_smoke_begin() {
    ensure_adc_init();
    pinMode(PIN_MQ2_AO, INPUT);
}

void sensors_smoke_read(SmokeData* out) {
    memset(out, 0, sizeof(SmokeData));
    out->raw_adc = read_adc_smooth(ADC1_CHANNEL_6);
    float voltage = out->raw_adc * 3.3f / 4095.0f;
    float rs = (3.3f - voltage) / voltage * MQ2_R0_KOHM;
    if (rs < 0.1f) rs = 0.1f;
    float ratio = rs / MQ2_R0_KOHM;
    out->concentration_ppm = (ratio - 1.0f) * 300.0f;
    if (out->concentration_ppm < 0) out->concentration_ppm = 0;
    out->alarm = (out->concentration_ppm > SMOKE_ALARM_PPM);
}

// ==================== Gas (MQ-9) ====================
void sensors_gas_begin() {
    ensure_adc_init();
    pinMode(PIN_MQ9_AO, INPUT);
}

void sensors_gas_read(GasData* out) {
    memset(out, 0, sizeof(GasData));
    out->raw_adc = read_adc_smooth(ADC1_CHANNEL_4);
    float voltage = out->raw_adc * 3.3f / 4095.0f;
    float rs = (3.3f - voltage) / voltage * MQ9_R0_KOHM;
    if (rs < 0.1f) rs = 0.1f;
    float ratio = rs / MQ9_R0_KOHM;
    out->concentration_ppm = (ratio - 1.0f) * 250.0f;
    if (out->concentration_ppm < 0) out->concentration_ppm = 0;
    out->alarm = (out->concentration_ppm > GAS_ALARM_PPM);
}

// ==================== Phone Module UART ====================
static HardwareSerial PhoneSerial(2);  // UART2 on GPIO26/27
static unsigned long lastPhoneUART = 0;
static uint8_t lastHeartRate = 0;
static uint8_t lastSpO2 = 0;
static uint8_t lastBattery = 100;
static bool lastSosState = false;

void sensors_phone_begin() {
    PhoneSerial.begin(PHONE_BAUD, SERIAL_8N1, PIN_PHONE_RX, PIN_PHONE_TX);
}

static void sensors_phone_parse(const uint8_t* data, size_t len) {
    // Protocol from phone module: "$HR:72,98,85\r\n" or "$SOS\r\n"
    for (size_t i = 0; i < len; i++) {
        if (data[i] == '$') {
            String cmd = "";
            size_t j = i + 1;
            while (j < len && data[j] != '\r' && data[j] != '\n' && cmd.length() < 20) {
                cmd += (char)data[j++];
            }
            if (cmd.startsWith("HR:")) {
                // HR:heart_rate,spo2,battery
                int p1 = cmd.indexOf(':');
                int p2 = cmd.indexOf(',');
                int p3 = cmd.lastIndexOf(',');
                if (p2 > p1 && p3 > p2) {
                    lastHeartRate = (uint8_t)cmd.substring(p1+1, p2).toInt();
                    lastSpO2 = (uint8_t)cmd.substring(p2+1, p3).toInt();
                    lastBattery = (uint8_t)cmd.substring(p3+1).toInt();
                }
            } else if (cmd.startsWith("SOS")) {
                lastSosState = true;
            }
        }
    }
}

void sensors_phone_read(PhoneData* out) {
    memset(out, 0, sizeof(PhoneData));
    out->button_pressed = lastSosState;
    out->heart_rate = lastHeartRate;
    out->blood_oxygen = lastSpO2;
    out->battery_percent = lastBattery;

    if (PhoneSerial.available()) {
        static uint8_t buf[64];
        static size_t bufLen = 0;
        while (PhoneSerial.available() && bufLen < sizeof(buf)) {
            uint8_t c = PhoneSerial.read();
            if (c == '\n' || c == '\r') {
                if (bufLen > 0) {
                    sensors_phone_parse(buf, bufLen);
                    bufLen = 0;
                }
            } else {
                buf[bufLen++] = c;
            }
        }
        lastPhoneUART = millis();
    }
    out->connected = (millis() - lastPhoneUART < 5000);
}

// ==================== Buzzer & LED ====================
void sensors_actuators_begin() {
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
    pinMode(PIN_LED_STATUS, OUTPUT);
    digitalWrite(PIN_LED_STATUS, LOW);
    pinMode(PIN_STATUS_WORK, OUTPUT);
    digitalWrite(PIN_STATUS_WORK, LOW);
    pinMode(PIN_STATUS_ALARM, OUTPUT);
    digitalWrite(PIN_STATUS_ALARM, LOW);
    pinMode(PIN_STATUS_LOST, OUTPUT);
    digitalWrite(PIN_STATUS_LOST, LOW);
    pinMode(PIN_STATUS_DATA, OUTPUT);
    digitalWrite(PIN_STATUS_DATA, LOW);
}

void sensors_actuators_set(bool alarmActive, bool heartbeat) {
    // Status bus: WORK=14, ALARM=25, LOST=13, DATA=12
    digitalWrite(PIN_STATUS_WORK, heartbeat ? HIGH : LOW);
    digitalWrite(PIN_STATUS_ALARM, alarmActive ? HIGH : LOW);
    digitalWrite(PIN_STATUS_LOST, LOW);  // Set when ESP offline
    digitalWrite(PIN_STATUS_DATA, heartbeat ? HIGH : LOW);

    // Local buzzer and LED
    digitalWrite(PIN_BUZZER, alarmActive ? HIGH : LOW);
    digitalWrite(PIN_LED_STATUS, heartbeat ? HIGH : LOW);
}

// ==================== Combined ====================
static unsigned long startTime = 0;

void sensors_begin() {
    startTime = millis();
    sensors_ld2420_begin();
    sensors_smoke_begin();
    sensors_gas_begin();
    sensors_phone_begin();
    sensors_actuators_begin();
}

void sensors_read_all(SensorStatus* out) {
    sensors_ld2420_read(&out->radar);
    sensors_smoke_read(&out->smoke);
    sensors_gas_read(&out->gas);
    sensors_phone_read(&out->phone);
    out->uptime_s = (millis() - startTime) / 1000;

    bool alarm = out->smoke.alarm || out->gas.alarm || out->radar.fall_detected || out->phone.button_pressed;
    static bool ledToggle = false;
    static unsigned long lastLedToggle = 0;
    unsigned long now = millis();
    if (now - lastLedToggle > (alarm ? 200 : 1000)) {
        ledToggle = !ledToggle;
        lastLedToggle = now;
    }
    sensors_actuators_set(alarm, ledToggle);
}
