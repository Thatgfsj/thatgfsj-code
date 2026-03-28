#include "config.h"
#include "wifi_mqtt.h"
#include <HTTPClient.h>

// ==================== WiFiManager ====================
WiFiManager::WiFiManager() {
    connecting = false;
    connectStartTime = 0;
}

void WiFiManager::begin(const char* ssid, const char* password) {
    connectAsync(ssid, password);
}

bool WiFiManager::connectAsync(const char* ssid, const char* password) {
    if (WiFi.isConnected()) {
        WiFi.disconnect();
        delay(100);
    }
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    connecting = true;
    connectStartTime = millis();
    Serial.printf("[WiFi] Connecting to %s...\n", ssid);
    return true;
}

bool WiFiManager::isConnecting() {
    return connecting && WiFi.status() == WL_IDLE_STATUS;
}

bool WiFiManager::isConnected() {
    if (!connecting) return WiFi.isConnected();
    
    if (WiFi.isConnected()) {
        connecting = false;
        Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        return true;
    }
    
    if (millis() - connectStartTime > WIFI_CONNECT_TIMEOUT_MS) {
        connecting = false;
        Serial.println("[WiFi] Connection timed out");
    }
    
    return false;
}

int8_t WiFiManager::getRSSI() {
    if (WiFi.isConnected()) {
        return WiFi.RSSI();
    }
    return -127;
}

void WiFiManager::disconnect() {
    WiFi.disconnect();
    connecting = false;
}

void WiFiManager::handle() {
    isConnected();  // Check for timeout
}

// ==================== DataPoster ====================
DataPoster::DataPoster() {
    lastPostTime = 0;
    postInterval = HTTP_POST_INTERVAL_MS;
    lastError[0] = '\0';
}

void DataPoster::begin(const char* host, uint16_t port, const char* deviceId) {
    this->host = host;
    this->port = port;
    this->deviceId = deviceId;
}

bool DataPoster::waitForServer(int timeout_ms) {
    if (!WiFi.isConnected()) return false;
    
    HTTPClient http;
    String url = String("http://") + host + ":" + port + "/api/health";
    
    http.begin(url);
    http.setTimeout(timeout_ms);
    
    int httpCode = http.GET();
    http.end();
    
    return (httpCode > 0);  // Any response means server is up
}

bool DataPoster::postJSON(const String& jsonPayload) {
    if (!WiFi.isConnected()) {
        snprintf(lastError, sizeof(lastError), "WiFi not connected");
        return false;
    }
    
    HTTPClient http;
    String url = String("http://") + host + ":" + port + "/api/sensor-data";
    
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-ID", deviceId);
    http.setTimeout(10000);
    
    int httpCode = http.POST(jsonPayload);
    String response = http.getString();
    http.end();
    
    if (httpCode == 200 || httpCode == 201) {
        lastPostTime = millis();
        Serial.printf("[HTTP] POST OK: %d\n", httpCode);
        return true;
    } else {
        snprintf(lastError, sizeof(lastError), "HTTP %d: %s", httpCode, response.c_str());
        Serial.printf("[HTTP] POST failed: %s\n", lastError);
        return false;
    }
}

bool DataPoster::isServerReachable() {
    return waitForServer(3000);
}
