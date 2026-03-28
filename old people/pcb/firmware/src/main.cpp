#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sensors.h"
#include "ble_service.h"
#include "wifi_mqtt.h"

// ==================== Global Instances ====================
ElderCareBLEService bleService;
WiFiManager wifiManager;
DataPoster dataPoster;
String deviceId;

// ==================== Runtime Config ====================
static struct {
    bool wifi_enabled = false;
    bool http_enabled = false;
    uint32_t http_interval_ms = 30000;
    const char* wifi_ssid = "YourWiFiSSID";
    const char* wifi_pass = "YourWiFiPassword";
    const char* server_host = "192.168.1.100";
    uint16_t server_port = 8080;
} runtimeConfig;

static unsigned long lastSensorRead = 0;
static unsigned long lastHTTPPost = 0;
static unsigned long lastLEDBlink = 0;
static bool ledState = false;

// ==================== Forward Declaration ====================
void sendSensorJSON(SensorStatus& status);

// ==================== BLE Command Handler ====================
class MyBLECallbacks : public BLECallbacks {
    void onBLECommandReceived(const String& cmd, const String& value) override {
        Serial.printf("[BLE CMD] cmd=%s value=%s\n", cmd.c_str(), value.c_str());

        if (cmd == "get_status") {
            SensorStatus st;
            sensors_read_all(&st);
            sendSensorJSON(st);
        }
        else if (cmd == "wifi_status") {
            String reply = "{\"cmd\":\"wifi_status\",\"connected\":";
            reply += wifiManager.isConnected() ? "true" : "false";
            reply += ",\"rssi\":" + String(wifiManager.getRSSI()) + "}";
            bleService.updateSensorData(reply);
        }
        else if (cmd == "set_http") {
            runtimeConfig.http_enabled = (value == "on");
            String reply = "{\"cmd\":\"set_http\",\"result\":\"ok\",\"enabled\":";
            reply += runtimeConfig.http_enabled ? "true" : "false";
            reply += "}";
            bleService.updateSensorData(reply);
        }
        else if (cmd == "version") {
            String reply = "{\"cmd\":\"version\",\"fw\":\"" FIRMWARE_VERSION "\"}";
            bleService.updateSensorData(reply);
        }
        else if (cmd == "reboot") {
            bleService.updateSensorData("{\"cmd\":\"reboot\",\"result\":\"ok\"}");
            delay(100);
            ESP.restart();
        }
        else if (cmd == "wifi") {
            // Format: {"cmd":"wifi","ssid":"MySSID","pass":"MyPass"}
            int s = value.indexOf(',');
            if (s > 0) {
                runtimeConfig.wifi_ssid = value.substring(0, s).c_str();
                runtimeConfig.wifi_pass = value.substring(s+1).c_str();
                runtimeConfig.wifi_enabled = true;
                wifiManager.begin(runtimeConfig.wifi_ssid, runtimeConfig.wifi_pass);
                dataPoster.begin(runtimeConfig.server_host, runtimeConfig.server_port, deviceId.c_str());
                bleService.updateSensorData("{\"cmd\":\"wifi\",\"result\":\"connecting\"}");
            }
        }
    }
};
static MyBLECallbacks bleCallbacks;

// ==================== Build & Send JSON ====================
void sendSensorJSON(SensorStatus& st) {
    DynamicJsonDocument doc(1024);

    doc["device_id"] = deviceId;
    doc["timestamp"] = time(nullptr);
    doc["uptime_s"] = st.uptime_s;
    doc["wifi_rssi"] = st.wifi_rssi;
    doc["fw_version"] = FIRMWARE_VERSION;

    JsonObject radar = doc["sensors"].createNestedObject("radar");
    radar["target_detected"] = st.radar.target_detected;
    radar["fall_detected"] = st.radar.fall_detected;
    radar["target_count"] = st.radar.target_count;
    radar["x_mm"] = st.radar.x_mm;
    radar["y_mm"] = st.radar.y_mm;
    radar["speed_mm_s"] = st.radar.speed_mm_s;

    JsonObject smoke = doc["sensors"].createNestedObject("smoke");
    smoke["concentration"] = st.smoke.concentration_ppm;
    smoke["alarm"] = st.smoke.alarm;
    smoke["unit"] = "ppm";
    smoke["raw_adc"] = st.smoke.raw_adc;

    JsonObject gas = doc["sensors"].createNestedObject("gas");
    gas["concentration"] = st.gas.concentration_ppm;
    gas["alarm"] = st.gas.alarm;
    gas["unit"] = "ppm";
    gas["raw_adc"] = st.gas.raw_adc;

    JsonObject phone = doc["sensors"].createNestedObject("phone");
    phone["heart_rate"] = st.phone.heart_rate;
    phone["blood_oxygen"] = st.phone.blood_oxygen;
    phone["button_pressed"] = st.phone.button_pressed;
    phone["battery"] = st.phone.battery_percent;
    phone["connected"] = st.phone.connected;

    String output;
    serializeJson(doc, output);

    bleService.updateSensorData(output);
    Serial.printf("[BLE] Sent: %s\n", output.c_str());

    // HTTP POST
    if (runtimeConfig.http_enabled && runtimeConfig.wifi_enabled &&
        wifiManager.isConnected() &&
        (millis() - lastHTTPPost >= runtimeConfig.http_interval_ms)) {
        dataPoster.postJSON(output);
        lastHTTPPost = millis();
    }
}

// ==================== Setup ====================
void setup() {
    Serial.begin(SERIAL_BAUD);
    Serial.printf("\n========== ElderCare v%s ==========\n", FIRMWARE_VERSION);

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    deviceId = String(DEVICE_ID_PREFIX) +
               String(mac[3] & 0xFF, HEX) +
               String(mac[4] & 0xFF, HEX) +
               String(mac[5] & 0xFF, HEX);
    deviceId.toUpperCase();
    Serial.printf("Device ID: %s\n", deviceId.c_str());

    sensors_begin();
    Serial.println("[Sensors] Initialized");

    bleService.begin(deviceId);
    bleService.setCommandCallback(&bleCallbacks);
    Serial.println("[BLE] Started advertising");

    Serial.println("[System] Ready");
}

// ==================== Main Loop ====================
void loop() {
    unsigned long now = millis();

    wifiManager.handle();
    bleService.checkConnection();

    if (now - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
        lastSensorRead = now;

        SensorStatus st;
        sensors_read_all(&st);
        st.wifi_rssi = wifiManager.getRSSI();
        sendSensorJSON(st);

        Serial.printf("[Status] Radar=%d Fall=%d Smoke=%d(%s) Gas=%d(%s) HR=%d SOS=%d\n",
            st.radar.target_detected,
            st.radar.fall_detected,
            (int)st.smoke.concentration_ppm,
            st.smoke.alarm ? "ALARM" : "OK",
            (int)st.gas.concentration_ppm,
            st.gas.alarm ? "ALARM" : "OK",
            st.phone.heart_rate,
            st.phone.button_pressed);
    }

    // Process serial commands
    while (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        if (cmd.length() == 0) continue;

        Serial.printf("[Serial] %s\n", cmd.c_str());
        if (cmd == "status") {
            SensorStatus s; sensors_read_all(&s); sendSensorJSON(s);
        } else if (cmd.startsWith("wifi ")) {
            int s1 = cmd.indexOf(' ', 5);
            if (s1 > 0) {
                int s2 = cmd.indexOf(' ', s1+1);
                if (s2 > 0) {
                    runtimeConfig.wifi_ssid = cmd.substring(5, s1).c_str();
                    runtimeConfig.wifi_pass = cmd.substring(s1+1, s2).c_str();
                    runtimeConfig.wifi_enabled = true;
                    wifiManager.begin(runtimeConfig.wifi_ssid, runtimeConfig.wifi_pass);
                    dataPoster.begin(runtimeConfig.server_host, runtimeConfig.server_port, deviceId.c_str());
                    Serial.printf("WiFi connecting to: %s\n", runtimeConfig.wifi_ssid);
                }
            }
        } else if (cmd == "wifi off") {
            wifiManager.disconnect();
            runtimeConfig.wifi_enabled = false;
        } else if (cmd == "reboot") {
            ESP.restart();
        } else if (cmd == "version") {
            Serial.printf("FW: %s\n", FIRMWARE_VERSION);
        } else if (cmd == "help") {
            Serial.println("Commands: status, wifi <ssid> <pass>, wifi off, reboot, version");
        }
    }

    delay(10);
}
