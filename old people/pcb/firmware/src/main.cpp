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

// ==================== Device ID ====================
String deviceId;

// ==================== Configurable Parameters ====================
// These can be set via BLE commands at runtime
static struct {
    const char* wifi_ssid = DEFAULT_WIFI_SSID;
    const char* wifi_pass = DEFAULT_WIFI_PASS;
    const char* server_host = DEFAULT_SERVER_HOST;
    uint16_t server_port = DEFAULT_SERVER_PORT;
    uint32_t http_interval_ms = HTTP_POST_INTERVAL_MS;
    bool http_enabled = false;
    bool wifi_enabled = false;
} runtimeConfig;

// ==================== Timing ====================
static unsigned long lastSensorRead = 0;
static unsigned long lastHTTPPost = 0;
static unsigned long lastLEDBlink = 0;
static bool ledState = false;

// ==================== LED ====================
#define PIN_LED 2  // On-board LED on most ESP32 dev boards

void led_setup() {
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, LOW);
}

// ==================== BLE Command Handler ====================
class MyBLECallbacks : public BLECallbacks {
    void onBLECommandReceived(const String& cmd, const String& value) override {
        Serial.printf("[CMD] Received: cmd=%s, value=%s\n", cmd.c_str(), value.c_str());
        
        if (cmd == "get_status") {
            // Force a sensor read and send data
            SensorStatus status;
            sensors_read_all(&status);
            sendSensorJSON(status);
        }
        else if (cmd == "set_wifi") {
            // Expected: {"cmd":"set_wifi","ssid":"MySSID","pass":"MyPass"}
            // We'll handle via param parsing
        }
        else if (cmd == "wifi_status") {
            String reply = "{\"cmd\":\"wifi_status\",\"connected\":";
            reply += wifiManager.isConnected() ? "true" : "false";
            reply += ",\"rssi\":" + String(wifiManager.getRSSI()) + "}";
            bleService.updateSensorData(reply);
        }
        else if (cmd == "reboot") {
            ESP.restart();
        }
        else if (cmd == "set_http") {
            runtimeConfig.http_enabled = (value == "on");
        }
        else if (cmd == "version") {
            String reply = "{\"cmd\":\"version\",\"fw\":\"" FIRMWARE_VERSION "\"}";
            bleService.updateSensorData(reply);
        }
    }
};

static MyBLECallbacks bleCallbacks;

// ==================== Build Sensor JSON ====================
void sendSensorJSON(SensorStatus& status) {
    DynamicJsonDocument doc(1024);
    
    doc["device_id"] = deviceId;
    doc["timestamp"] = time(nullptr);  // Will be 0 if NTP not configured
    doc["uptime_s"] = status.uptime_s;
    doc["wifi_rssi"] = status.wifi_rssi;
    doc["fw_version"] = FIRMWARE_VERSION;
    
    // LD2450 radar
    JsonObject ld2450 = doc["sensors"].createNestedObject("ld2450");
    ld2450["target_detected"] = status.ld2450.target_detected;
    ld2450["fall_detected"] = status.ld2450.fall_detected;
    ld2450["target_count"] = status.ld2450.target_count;
    ld2450["x_mm"] = status.ld2450.x_mm;
    ld2450["y_mm"] = status.ld2450.y_mm;
    ld2450["speed_mm_s"] = status.ld2450.speed_mm_s;
    
    // Smoke sensor
    JsonObject smoke = doc["sensors"].createNestedObject("smoke");
    smoke["concentration"] = status.smoke.concentration_ppm;
    smoke["alarm"] = status.smoke.alarm;
    smoke["unit"] = "ppm";
    smoke["raw_adc"] = status.smoke.raw_adc;
    
    // Gas sensor
    JsonObject gas = doc["sensors"].createNestedObject("gas");
    gas["concentration"] = status.gas.concentration_ppm;
    gas["alarm"] = status.gas.alarm;
    gas["unit"] = "ppm";
    gas["raw_adc"] = status.gas.raw_adc;
    
    // Bracelet
    JsonObject bracelet = doc["sensors"].createNestedObject("bracelet");
    bracelet["heart_rate"] = status.bracelet.heart_rate;
    bracelet["blood_oxygen"] = status.bracelet.blood_oxygen;
    bracelet["button_pressed"] = status.bracelet.button_pressed;
    bracelet["battery"] = status.bracelet.battery_percent;
    bracelet["connected"] = status.bracelet.bracelet_connected;
    
    // Serialize and send via BLE
    String output;
    serializeJson(doc, output);
    
    bleService.updateSensorData(output);
    Serial.printf("[BLE] Sent: %s\n", output.c_str());
    
    // Also HTTP POST if enabled and interval elapsed
    if (runtimeConfig.http_enabled && runtimeConfig.wifi_enabled && 
        wifiManager.isConnected() && 
        (millis() - lastHTTPPost >= runtimeConfig.http_interval_ms)) {
        
        bool ok = dataPoster.postJSON(output);
        if (!ok) {
            Serial.printf("[HTTP] Post failed: %s\n", dataPoster.getLastError());
        }
        lastHTTPPost = millis();
    }
}

// ==================== Setup ====================
void setup() {
    Serial.begin(SERIAL_BAUD);
    Serial.printf("\n========== ElderCare ESP32 Firmware v%s ==========\n", FIRMWARE_VERSION);
    
    // Generate unique device ID from MAC address
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    deviceId = String(DEVICE_ID_PREFIX) + 
               String(mac[3] & 0xFF, HEX) + 
               String(mac[4] & 0xFF, HEX) +
               String(mac[5] & 0xFF, HEX);
    deviceId.toUpperCase();
    Serial.printf("Device ID: %s\n", deviceId.c_str());
    
    // Initialize sensors
    sensors_begin();
    Serial.println("[Sensors] Initialized");
    
    // Initialize BLE
    bleService.begin(deviceId);
    bleService.setCommandCallback(&bleCallbacks);
    Serial.println("[BLE] Service started, advertising...");
    
    // Initialize LED
    led_setup();
    
    // Initialize WiFi (disabled by default, enable via BLE or config)
    // wifiManager.begin(runtimeConfig.wifi_ssid, runtimeConfig.wifi_pass);
    // dataPoster.begin(runtimeConfig.server_host, runtimeConfig.server_port, deviceId.c_str());
    
    Serial.println("[System] Setup complete, entering main loop...");
    Serial.println("[System] Use BLE or Serial commands to interact.");
}

// ==================== Main Loop ====================
void loop() {
    unsigned long now = millis();
    
    // Handle WiFi
    wifiManager.handle();
    
    // Handle BLE connection
    bleService.checkConnection();
    
    // Sensor reading (every 2 seconds)
    if (now - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
        lastSensorRead = now;
        
        // Update uptime
        sensors_update_uptime();
        
        // Read all sensors
        SensorStatus status;
        sensors_read_all(&status);
        
        // Update WiFi RSSI in status
        status.wifi_rssi = wifiManager.getRSSI();
        
        // Build and send JSON via BLE
        sendSensorJSON(status);
        
        // Also print to Serial
        Serial.printf("[Status] Target=%d Fall=%d Smoke=%d(%s) Gas=%d(%s) HR=%d BTN=%d\n",
            status.ld2450.target_detected,
            status.ld2450.fall_detected,
            (int)status.smoke.concentration_ppm,
            status.smoke.alarm ? "ALARM" : "OK",
            (int)status.gas.concentration_ppm,
            status.gas.alarm ? "ALARM" : "OK",
            status.bracelet.heart_rate,
            status.bracelet.button_pressed);
    }
    
    // LED heartbeat (slow blink when OK, fast when alarm)
    bool anyAlarm = false;  // Would check sensor data here
    unsigned long blinkInterval = anyAlarm ? 200 : 1000;
    
    if (now - lastLEDBlink >= blinkInterval) {
        lastLEDBlink = now;
        ledState = !ledState;
        digitalWrite(PIN_LED, ledState ? HIGH : LOW);
    }
    
    // Process Serial commands (for debugging)
    while (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        if (cmd.length() > 0) {
            Serial.printf("[Serial CMD] %s\n", cmd.c_str());
            // Handle simple serial commands
            if (cmd == "status") {
                SensorStatus s;
                sensors_read_all(&s);
                sendSensorJSON(s);
            } else if (cmd.startsWith("wifi ")) {
                // wifi MySSID MyPass
                int space1 = cmd.indexOf(' ', 5);
                if (space1 > 0) {
                    String ssid = cmd.substring(5, space1);
                    String pass = cmd.substring(space1 + 1);
                    runtimeConfig.wifi_ssid = ssid.c_str();
                    runtimeConfig.wifi_pass = pass.c_str();
                    runtimeConfig.wifi_enabled = true;
                    wifiManager.begin(runtimeConfig.wifi_ssid, runtimeConfig.wifi_pass);
                    dataPoster.begin(runtimeConfig.server_host, runtimeConfig.server_port, deviceId.c_str());
                    Serial.printf("WiFi connecting to: %s\n", ssid.c_str());
                }
            } else if (cmd == "wifi on") {
                runtimeConfig.wifi_enabled = true;
                wifiManager.begin(runtimeConfig.wifi_ssid, runtimeConfig.wifi_pass);
                dataPoster.begin(runtimeConfig.server_host, runtimeConfig.server_port, deviceId.c_str());
            } else if (cmd == "wifi off") {
                wifiManager.disconnect();
                runtimeConfig.wifi_enabled = false;
            } else if (cmd == "help") {
                Serial.println("Commands: status, wifi <ssid> <pass>, wifi on/off, reboot, version");
            } else if (cmd == "reboot") {
                ESP.restart();
            } else if (cmd == "version") {
                Serial.printf("Firmware: %s\n", FIRMWARE_VERSION);
            }
        }
    }
    
    delay(10);  // Small yield to prevent watchdog
}
