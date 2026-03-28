#include "config.h"
#include "sensors.h"
#include <driver/adc.h>
#include <esp_adc_cal.h>

// ==================== LD2450 Radar ====================
static HardwareSerial LD2450Serial(1);  // UART1

void sensors_ld2450_begin() {
    LD2450Serial.begin(LD2450_BAUD, SERIAL_8N1, PIN_LD2450_RX, PIN_LD2450_TX);
}

bool sensors_ld2450_parse(const uint8_t* buf, size_t len, LD2450Data* out) {
    // LD2450 protocol: header 0xAA 0xFF 0x03, then data
    // Simplified: look for sync header and try to decode
    // Real implementation would need full protocol analysis
    if (len < 8) return false;
    
    // Find header
    for (size_t i = 0; i < len - 3; i++) {
        if (buf[i] == 0xAA && buf[i+1] == 0xFF && buf[i+2] == 0x03) {
            uint8_t dataLen = buf[i+3];
            if (i + 3 + dataLen + 1 > len) return false;  // not enough data
            
            // Target count is at offset 4
            uint8_t targetCount = buf[i+4];
            out->target_count = targetCount;
            
            if (targetCount > 0 && targetCount <= 3) {
                // Parse first target: 6 bytes starting at offset 5
                // Format: [target_flag(1)] [x(2)] [y(2)] [speed(2)] ...
                size_t base = i + 5;
                out->target_detected = (buf[base] & 0x01) != 0;
                out->x_mm = (int16_t)(buf[base+1] | (buf[base+2] << 8));
                out->y_mm = (int16_t)(buf[base+3] | (buf[base+4] << 8));
                out->speed_mm_s = (int16_t)(buf[base+5] | (buf[base+6] << 8));
                
                // Simple fall detection heuristic:
                // If target is close (< 100cm) and moving fast (> 500mm/s) 
                // then suddenly stops, might be a fall
                // This is a simplified placeholder - real fall detection
                // uses posture analysis over time
                static int16_t lastY = 0;
                static unsigned long lastFallCheck = 0;
                unsigned long now = millis();
                
                if (now - lastFallCheck > 500) {
                    if (out->y_mm < 1000 && abs(out->speed_mm_s) > 800) {
                        out->trigger_counter++;
                        if (out->trigger_counter >= 3) {
                            out->fall_detected = true;
                        }
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

void sensors_ld2450_read(LD2450Data* out) {
    memset(out, 0, sizeof(LD2450Data));
    
    if (LD2450Serial.available()) {
        static uint8_t buf[64];
        static size_t bufLen = 0;
        
        while (LD2450Serial.available() && bufLen < sizeof(buf)) {
            buf[bufLen++] = LD2450Serial.read();
        }
        
        // Try to parse complete frame
        if (sensors_ld2450_parse(buf, bufLen, out)) {
            bufLen = 0;  // reset on successful parse
        }
        
        // If buffer is getting full but no valid frame, reset
        if (bufLen > 30) bufLen = 0;
    }
}

// ==================== ADC Setup ====================
static bool adcInitialized = false;

static void ensure_adc_init() {
    if (adcInitialized) return;
    
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(ADC1_CHANNEL_6, ADC_ATTEN_DB_11);  // GPIO34
    adc1_config_channel_atten(ADC1_CHANNEL_7, ADC_ATTEN_DB_11);  // GPIO35
    
    // Characterize ADC at 11dB attenuation (0-3.3V range)
    // We don't use esp_adc_cal here to keep it simple
    adcInitialized = true;
}

uint16_t read_adc_smooth(int pin, int samples) {
    ensure_adc_init();
    
    int adcChannel = 0;
    if (pin == 34) adcChannel = ADC1_CHANNEL_6;
    else if (pin == 35) adcChannel = ADC1_CHANNEL_7;
    
    int sum = 0;
    for (int i = 0; i < samples; i++) {
        sum += adc1_get_raw(adcChannel);
        delayMicroseconds(100);
    }
    return sum / samples;
}

// ==================== Smoke Sensor (MQ-2/MQ-135) ====================
void sensors_smoke_begin() {
    ensure_adc_init();
    pinMode(PIN_SMOKE_SENSOR, INPUT);
}

void sensors_smoke_read(SmokeData* out) {
    memset(out, 0, sizeof(SmokeData));
    
    out->raw_adc = read_adc_smooth(PIN_SMOKE_SENSOR, 16);
    
    // Convert ADC to voltage (0-4095 -> 0-3.3V)
    float voltage = out->raw_adc * 3.3f / 4095.0f;
    
    // Load resistor circuit: VRL = voltage, RL = 10kΩ
    // RS = (3.3V - VRL) / VRL * RL (in kΩ)
    float rs = (3.3f - voltage) / voltage * SMOKE_SENSOR_R0_KOHM;
    
    // Clean air ratio (in fresh air, RS/R0 ≈ 1 for MQ-2)
    // Smoke concentration approximation: 
    // ppm ≈ 613.9 * (RS/R0)^2 - 126.5 * (RS/R0)
    // Simplified: use a linear scale for typical range
    float ratio = rs / SMOKE_SENSOR_R0_KOHM;
    
    // Clamp ratio to avoid inf
    if (ratio < 0.1f) ratio = 0.1f;
    if (ratio > 10.0f) ratio = 10.0f;
    
    // Simplified linear mapping (0-1000 ppm range)
    // Higher ADC = lower RS = more gas = higher ppm
    out->concentration_ppm = (ratio - 1.0f) * 300.0f;
    if (out->concentration_ppm < 0) out->concentration_ppm = 0;
    
    out->alarm = (out->concentration_ppm > SMOKE_ALARM_PPM);
}

// ==================== Gas Sensor ====================
void sensors_gas_begin() {
    ensure_adc_init();
    pinMode(PIN_GAS_SENSOR, INPUT);
}

void sensors_gas_read(GasData* out) {
    memset(out, 0, sizeof(GasData));
    
    out->raw_adc = read_adc_smooth(PIN_GAS_SENSOR, 16);
    
    float voltage = out->raw_adc * 3.3f / 4095.0f;
    float rs = (3.3f - voltage) / voltage * GAS_SENSOR_R0_KOHM;
    
    float ratio = rs / GAS_SENSOR_R0_KOHM;
    if (ratio < 0.1f) ratio = 0.1f;
    if (ratio > 10.0f) ratio = 10.0f;
    
    // Similar to smoke but for methane/hydrocarbon gases
    out->concentration_ppm = (ratio - 1.0f) * 250.0f;
    if (out->concentration_ppm < 0) out->concentration_ppm = 0;
    
    out->alarm = (out->concentration_ppm > GAS_ALARM_PPM);
}

// ==================== Bracelet (Emergency + Health) ====================
// We'll simulate the bracelet with UART input for now.
// In production, this would parse a proprietary protocol from the bracelet module.
static HardwareSerial BraceletSerial(2);  // UART2 on GPIO26(RX)/27(TX)

void sensors_bracelet_begin() {
    BraceletSerial.begin(9600, SERIAL_8N1, 26, 27);
    pinMode(PIN_BRACELET_BUTTON, INPUT_PULLUP);
}

void sensors_bracelet_parse_uart(const uint8_t* data, size_t len) {
    // Expected format from bracelet: 
    // Example: "$HR:72,98,85\r\n" (heart_rate, SpO2, battery)
    // Or: "$SOS\r\n" for emergency button
    if (len < 4) return;
    
    // Find frame start
    for (size_t i = 0; i < len; i++) {
        if (data[i] == '$') {
            // Check command type
            String cmd = "";
            size_t j = i + 1;
            while (j < len && data[j] != '\r' && data[j] != '\n' && cmd.length() < 20) {
                cmd += (char)data[j++];
            }
            
            if (cmd.startsWith("HR:")) {
                // Heart rate data: "HR:72,98,85"
                int p1 = cmd.indexOf(':');
                int p2 = cmd.indexOf(',');
                if (p2 > p1) {
                    // Parse heart rate - would be stored in a static variable
                    // For now just debug print
                    // Serial.printf("Bracelet HR: %s\n", cmd.substring(p1+1).c_str());
                }
            } else if (cmd.startsWith("SOS")) {
                // Emergency button pressed on bracelet
                // This would set a flag in BraceletData
                // Serial.println("BRACELET SOS!");
            }
        }
    }
}

static unsigned long lastBraceletUART = 0;
static uint8_t lastHeartRate = 0;
static uint8_t lastSpO2 = 0;
static uint8_t lastBattery = 100;
static bool lastButtonState = false;

void sensors_bracelet_read(BraceletData* out) {
    memset(out, 0, sizeof(BraceletData));
    
    // Read button (active LOW)
    out->button_pressed = (digitalRead(PIN_BRACELET_BUTTON) == LOW);
    
    // Parse UART data from bracelet
    if (BraceletSerial.available()) {
        static uint8_t buf[64];
        static size_t bufLen = 0;
        
        while (BraceletSerial.available() && bufLen < sizeof(buf)) {
            uint8_t c = BraceletSerial.read();
            if (c == '\n' || c == '\r') {
                if (bufLen > 0) {
                    sensors_bracelet_parse_uart(buf, bufLen);
                    bufLen = 0;
                }
            } else {
                buf[bufLen++] = c;
            }
        }
        lastBraceletUART = millis();
    }
    
    // If no UART data in 5 seconds, bracelet may be disconnected
    out->bracelet_connected = (millis() - lastBraceletUART < 5000);
    
    // Use last known values (in production, these would be updated from UART)
    out->heart_rate = lastHeartRate;
    out->blood_oxygen = lastSpO2;
    out->battery_percent = lastBattery;
    out->button_pressed = out->button_pressed || lastButtonState;
}

// ==================== Combined System ====================
static unsigned long startTime = 0;

void sensors_begin() {
    startTime = millis();
    sensors_ld2450_begin();
    sensors_smoke_begin();
    sensors_gas_begin();
    sensors_bracelet_begin();
}

void sensors_update_uptime() {
    // Called periodically
}

void sensors_read_all(SensorStatus* out) {
    sensors_ld2450_read(&out->ld2450);
    sensors_smoke_read(&out->smoke);
    sensors_gas_read(&out->gas);
    sensors_bracelet_read(&out->bracelet);
    out->uptime_s = (millis() - startTime) / 1000;
    out->wifi_rssi = 0;  // Will be updated by WiFi manager
}
