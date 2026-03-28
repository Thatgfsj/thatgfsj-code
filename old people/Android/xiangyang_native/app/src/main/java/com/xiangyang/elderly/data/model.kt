package com.xiangyang.elderly.data

data class Elderly(
    val id: String,
    val name: String,
    val age: Int,
    val health: String,
    val phone: String,
    val address: String = ""
)

data class Device(
    val id: String,
    val name: String,
    val type: DeviceType,
    val status: DeviceStatus,
    val battery: Int,
    val elderly: String,
    val lastTime: String
)

enum class DeviceType(val icon: String, val label: String) {
    BRACELET("⌚", "智能手环"),
    RADAR("📡", "LD2450雷达"),
    SMOKE("🔥", "烟雾传感器"),
    GAS("⛽", "燃气传感器")
}

enum class DeviceStatus(val label: String) {
    ONLINE("在线"),
    OFFLINE("离线")
}

data class Alert(
    val id: String,
    val type: AlertType,
    val level: AlertLevel,
    val device: String,
    val elderly: String,
    val time: String,
    val desc: String,
    val status: AlertStatus = AlertStatus.PENDING,
    val notify: String = ""
)

enum class AlertType(val icon: String, val label: String) {
    FALL("📡", "跌倒检测"),
    SUSPECTED_FALL("⚠️", "疑似跌倒"),
    LYING_DOWN("🛏️", "躺下休息"),
    SMOKE("🔥", "烟雾报警"),
    GAS("⛽", "燃气报警"),
    SOS("🆘", "一键报警")
}

enum class AlertLevel {
    EMERGENCY, WARNING, NORMAL
}

enum class AlertStatus {
    PENDING, RESOLVED
}

data class Order(
    val id: String,
    val orderNo: String,
    val serviceName: String,
    val elderly: String,
    val phone: String,
    val price: Double,
    val time: String,
    val status: OrderStatus,
    val staff: String? = null,
    val rated: Boolean = false,
    val evaluation: String = ""
)

enum class OrderStatus(val label: String) {
    PENDING("待开始"),
    IN_PROGRESS("进行中"),
    COMPLETED("已完成"),
    CANCELLED("已取消")
}

data class Service(
    val id: Int,
    val icon: String,
    val name: String,
    val price: Int,
    val category: String,
    val desc: String
)

data class Notification(
    val id: String,
    val type: String,
    val title: String,
    val content: String,
    val time: String,
    val isRead: Boolean = false
)

data class HealthData(
    val heartRate: String = "72",
    val bloodPressure: String = "120/80",
    val temperature: String = "36.5",
    val bloodSugar: String = "5.6",
    val steps: String = "3250",
    val sleep: String = "7.5",
    val battery: Int = 85
)

data class Medicine(
    val id: Int,
    val name: String,
    val dose: String,
    val time: String,
    val enabled: Boolean = true
)

data class Booking(
    val service: Service,
    val elderly: String,
    val date: String,
    val time: String,
    val phone: String,
    val remark: String = ""
)

// ─────────────────────────────────────────────────────────────────────────────
// BLE Data Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Overall sensor data received from ESP32 via BLE Nordic UART Service.
 */
data class SensorData(
    val deviceId: String,
    val uptimeS: Long,
    val wifiRssi: Int,
    val fwVersion: String,
    val radar: RadarData?,
    val smoke: SmokeData?,
    val gas: GasData?,
    val phone: PhoneData?,
    val rawJson: String = ""
)

/**
 * LD2450 millimeter-wave radar data.
 */
data class RadarData(
    val targetDetected: Boolean,
    val fallDetected: Boolean,
    val targetCount: Int,
    val xMm: Int,
    val yMm: Int,
    val speedMmPerS: Int
) {
    /** Distance in centimeters (x^2 + y^2 sqrt) */
    val distanceCm: Int
        get() {
            val distSq = xMm * xMm + yMm * yMm
            return (kotlin.math.sqrt(distSq.toDouble()) / 10).toInt()
        }

    /** Human-readable distance string */
    val distanceDisplay: String
        get() = "${distanceCm}cm"

    /** Speed in cm/s */
    val speedCmPerS: Int
        get() = speedMmPerS / 10
}

/**
 * Smoke sensor (MQ-2 / MQ-135) data.
 */
data class SmokeData(
    val concentration: Float,
    val alarm: Boolean,
    val unit: String,
    val rawAdc: Int
) {
    companion object {
        const val ALARM_THRESHOLD_PPM = 200f
    }
}

/**
 * Gas sensor (MQ-5 / MQ-9) data.
 */
data class GasData(
    val concentration: Float,
    val alarm: Boolean,
    val unit: String,
    val rawAdc: Int
) {
    companion object {
        const val ALARM_THRESHOLD_PPM = 150f
    }
}

/**
 * Phone module data (ESP32 <-> Phone UART bridge).
 */
data class PhoneData(
    val heartRate: Int,
    val bloodOxygen: Int,
    val buttonPressed: Boolean,
    val battery: Int,
    val connected: Boolean
) {
    /** Heart rate status description */
    val heartRateStatus: String
        get() = when {
            heartRate < 60 -> "偏慢"
            heartRate > 100 -> "偏快"
            else -> "正常"
        }

    /** SpO2 status description */
    val spO2Status: String
        get() = when {
            bloodOxygen < 90 -> "偏低"
            bloodOxygen < 95 -> "略低"
            else -> "正常"
        }
}

/**
 * BLE connection state.
 */
enum class BleConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR
}
