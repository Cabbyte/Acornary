package top.protium.acornary

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

@SuppressLint("MissingPermission")
@Composable
fun PrinterPane() {
    val context = LocalContext.current
    val permissions = arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    var permitted by remember { mutableStateOf(permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }) }
    var status by remember { mutableStateOf("连接前请断开其他应用对 D101 的占用。") }
    val devices = remember { mutableStateListOf<BluetoothDevice>() }
    val probe = remember { D101Probe(context, { status = it }, { d -> if (devices.none { it.address == d.address }) devices.add(d) }) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        permitted = permissions.all { results[it] == true }
        if (permitted) probe.scan()
    }
    DisposableEffect(probe) { onDispose { probe.close() } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("NIIMBOT D101", style = MaterialTheme.typography.titleLarge)
        Text(status)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { if (permitted) { devices.clear(); probe.scan() } else permission.launch(permissions) }) { Text("搜索打印机") }
            OutlinedButton(onClick = { probe.disconnect(); status = "已断开" }) { Text("断开连接") }
        }
        devices.forEach { device ->
            OutlinedButton(onClick = { probe.connect(device) }) { Text(device.name ?: "D101") }
        }
        Text("当前先验证型号与 BLE 通道；打印功能将在协议验收后启用。", style = MaterialTheme.typography.bodySmall)
    }
}
