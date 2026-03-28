package com.xiangyang.elderly.ui.screens

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.BluetoothSearching
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.xiangyang.elderly.data.*
import com.xiangyang.elderly.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BleDeviceScreen(navController: androidx.navigation.NavHostController) {
    val context = LocalContext.current
    val sensorData by BleRepository.sensorData.collectAsState()
    val connectionState by BleRepository.connectionState.collectAsState()
    val scannedDevices by BleRepository.scannedDevices.collectAsState()
    val isScanning by BleRepository.isScanning.collectAsState()
    val errorMessage by BleRepository.errorMessage.collectAsState()
    val connectedDeviceName by BleRepository.connectedDeviceName.collectAsState()

    var hasPermissions by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { perms ->
        hasPermissions = perms.values.all { it }
        if (hasPermissions) {
            val enabled = BleRepository.isBluetoothEnabled()
            if (!enabled) {
                Toast.makeText(context, "请打开蓝牙", Toast.LENGTH_SHORT).show()
            }
        }
    }

    LaunchedEffect(Unit) {
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_FINE_LOCATION
            )
        } else {
            arrayOf(
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION
            )
        }
        permissionLauncher.launch(perms)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设备管理", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.Close, contentDescription = "关闭")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Connection status card
            item {
                ConnectionStatusCard(
                    state = connectionState,
                    deviceName = connectedDeviceName,
                    onDisconnect = { BleRepository.disconnect() }
                )
            }

            // Scan button
            item {
                Button(
                    onClick = { BleRepository.startScan() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = hasPermissions && !isScanning,
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(
                        if (isScanning) Icons.Default.BluetoothSearching else Icons.Default.Bluetooth,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(if (isScanning) "扫描中..." else "扫描设备")
                }
            }

            // Error message
            errorMessage?.let { err ->
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = DangerBg),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            err,
                            color = Danger,
                            modifier = Modifier.padding(12.dp),
                            fontSize = 14.sp
                        )
                    }
                }
            }

            // Scanned devices
            if (scannedDevices.isNotEmpty()) {
                item {
                    Text(
                        "找到 ${scannedDevices.size} 个设备",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                items(scannedDevices) { device: BluetoothDevice ->
                    ScannedDeviceItem(device = device) { addr ->
                        BleRepository.connect(addr)
                    }
                }
            }

            // ── Connected: Show sensor data ──────────────────────────────────
            if (connectionState == BleConnectionState.CONNECTED) {
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "传感器数据",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp
                    )
                }

                sensorData?.let { data ->
                    data.radar?.let { radar ->
                        item { RadarSensorCard(radar = radar) }
                    }
                    data.smoke?.let { smoke ->
                        item { SmokeSensorCard(smoke = smoke) }
                    }
                    data.gas?.let { gas ->
                        item { GasSensorCard(gas = gas) }
                    }
                    data.phone?.let { phone ->
                        item { PhoneSensorCard(phone = phone) }
                    }

                    item {
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = { BleRepository.refreshData() },
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(end = 6.dp),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(
                                    Icons.Default.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("刷新数据")
                            }
                            OutlinedButton(
                                onClick = { BleRepository.requestWifiStatus() },
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(start = 6.dp),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text("WiFi状态")
                            }
                        }
                    }
                } ?: item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceVariant),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            "等待数据...",
                            modifier = Modifier
                                .padding(24.dp)
                                .fillMaxWidth(),
                            textAlign = TextAlign.Center,
                            color = TextSecondary
                        )
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Status Card
// ─────────────────────────────────────────────────────────────────────────────
@Composable
private fun ConnectionStatusCard(
    state: BleConnectionState,
    deviceName: String?,
    onDisconnect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = when (state) {
                BleConnectionState.CONNECTED -> SuccessBg
                BleConnectionState.CONNECTING -> WarningBg
                else -> SurfaceVariant
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (state) {
                    BleConnectionState.CONNECTED -> Icons.Default.BluetoothConnected
                    BleConnectionState.CONNECTING -> Icons.Default.BluetoothSearching
                    else -> Icons.Default.Bluetooth
                },
                contentDescription = null,
                tint = when (state) {
                    BleConnectionState.CONNECTED -> Success
                    BleConnectionState.CONNECTING -> Warning
                    else -> TextSecondary
                },
                modifier = Modifier.size(32.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = when (state) {
                        BleConnectionState.CONNECTED -> "已连接"
                        BleConnectionState.CONNECTING -> "连接中..."
                        else -> "未连接"
                    },
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                if (state == BleConnectionState.CONNECTED && !deviceName.isNullOrEmpty()) {
                    Text(
                        text = deviceName,
                        fontSize = 12.sp,
                        color = TextSecondary
                    )
                }
            }
            if (state == BleConnectionState.CONNECTED) {
                TextButton(onClick = onDisconnect) {
                    Text("断开", color = Danger)
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanned Device Item
// ─────────────────────────────────────────────────────────────────────────────
@SuppressLint("MissingPermission")
@Composable
private fun ScannedDeviceItem(
    device: BluetoothDevice,
    onClick: (String) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick(device.address) },
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Bluetooth,
                contentDescription = null,
                tint = TealPrimary,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.name ?: "未知设备",
                    fontWeight = FontWeight.Medium,
                    color = TextPrimary
                )
                Text(
                    text = device.address,
                    fontSize = 12.sp,
                    color = TextSecondary
                )
            }
            Text(
                text = "点击连接",
                fontSize = 12.sp,
                color = TealPrimary
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Radar Sensor Card
// ─────────────────────────────────────────────────────────────────────────────
@Composable
private fun RadarSensorCard(radar: RadarData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = when {
                radar.fallDetected -> DangerBg
                radar.targetDetected -> SuccessBg
                else -> Surface
            }
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("📡", fontSize = 24.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "LD2420 毫米波雷达",
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = when {
                        radar.fallDetected -> "⚠️ 跌倒检测"
                        radar.targetDetected -> "🟢 检测到目标"
                        else -> "⚪ 无目标"
                    },
                    fontSize = 14.sp,
                    color = when {
                        radar.fallDetected -> Danger
                        radar.targetDetected -> Success
                        else -> TextSecondary
                    },
                    fontWeight = FontWeight.Medium
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SensorDataItem(
                    label = "目标数量",
                    value = "${radar.targetCount}",
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "X位置",
                    value = "${radar.xMm}mm",
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "Y位置",
                    value = "${radar.yMm}mm",
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SensorDataItem(
                    label = "距离",
                    value = radar.distanceDisplay,
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "速度",
                    value = "${radar.speedCmPerS}cm/s",
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "跌倒",
                    value = if (radar.fallDetected) "⚠️ 是" else "否",
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Smoke Sensor Card
// ─────────────────────────────────────────────────────────────────────────────
@Composable
private fun SmokeSensorCard(smoke: SmokeData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (smoke.alarm) DangerBg else Surface
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🔥", fontSize = 24.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "烟雾传感器 (MQ-2)",
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = if (smoke.alarm) "⚠️ 报警" else "🟢 正常",
                    fontSize = 14.sp,
                    color = if (smoke.alarm) Danger else Success,
                    fontWeight = FontWeight.Medium
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SensorDataItem(
                    label = "浓度",
                    value = "%.1f ppm".format(smoke.concentration),
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "阈值",
                    value = "%.0f ppm".format(SmokeData.ALARM_THRESHOLD_PPM),
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "原始ADC",
                    value = "${smoke.rawAdc}",
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gas Sensor Card
// ─────────────────────────────────────────────────────────────────────────────
@Composable
private fun GasSensorCard(gas: GasData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (gas.alarm) DangerBg else Surface
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("⛽", fontSize = 24.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "燃气传感器 (MQ-9)",
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = if (gas.alarm) "⚠️ 报警" else "🟢 正常",
                    fontSize = 14.sp,
                    color = if (gas.alarm) Danger else Success,
                    fontWeight = FontWeight.Medium
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SensorDataItem(
                    label = "浓度",
                    value = "%.1f ppm".format(gas.concentration),
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "阈值",
                    value = "%.0f ppm".format(GasData.ALARM_THRESHOLD_PPM),
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "原始ADC",
                    value = "${gas.rawAdc}",
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone Module Card
// ─────────────────────────────────────────────────────────────────────────────
@Composable
private fun PhoneSensorCard(phone: PhoneData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (phone.buttonPressed) DangerBg else Surface
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("📱", fontSize = 24.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "手机模块",
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = "🔋 ${phone.battery}%",
                    fontSize = 12.sp,
                    color = TextSecondary
                )
                Spacer(modifier = Modifier.width(8.dp))
                Box(
                    modifier = Modifier
                        .background(
                            if (phone.connected) SuccessBg else SurfaceVariant,
                            RoundedCornerShape(8.dp)
                        )
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = if (phone.connected) "🟢 已连接" else "⚪ 未连接",
                        fontSize = 12.sp,
                        color = TextPrimary
                    )
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SensorDataItem(
                    label = "心率",
                    value = "${phone.heartRate}bpm",
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "心率状态",
                    value = phone.heartRateStatus,
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SensorDataItem(
                    label = "血氧",
                    value = "${phone.bloodOxygen}%",
                    modifier = Modifier.weight(1f)
                )
                SensorDataItem(
                    label = "血氧状态",
                    value = phone.spO2Status,
                    modifier = Modifier.weight(1f)
                )
            }
            if (phone.buttonPressed) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Danger.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text(
                        "🆘 SOS按钮已按下！",
                        fontSize = 14.sp,
                        color = Danger,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Sensor Data Item
// ─────────────────────────────────────────────────────────────────────────────
@Composable
private fun SensorDataItem(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(label, fontSize = 12.sp, color = TextSecondary)
        Spacer(modifier = Modifier.height(2.dp))
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
    }
}
