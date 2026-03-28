#ifndef WIFI_MQTT_H
#define WIFI_MQTT_H

#include <Arduino.h>
#include <WiFi.h>

class WiFiManager {
public:
    WiFiManager();

    void begin(const char* ssid, const char* password);
    bool isConnected();
    int8_t getRSSI();
    void disconnect();
    void handle();

    // Non-blocking connect
    bool connectAsync(const char* ssid, const char* password);
    bool isConnecting();

private:
    unsigned long connectStartTime;
    bool connecting;
};

class DataPoster {
public:
    DataPoster();

    void begin(const char* host, uint16_t port, const char* deviceId);
    
    // HTTP POST JSON data
    bool postJSON(const String& jsonPayload);
    
    // Returns true if server is reachable
    bool isServerReachable();

    const char* getLastError() { return lastError; }

private:
    String host;
    uint16_t port;
    String deviceId;
    char lastError[128];
    unsigned long lastPostTime;
    unsigned long postInterval;

    bool waitForServer(int timeout_ms = 5000);
};

#endif // WIFI_MQTT_H
