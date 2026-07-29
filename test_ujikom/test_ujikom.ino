#include <WiFi.h>
#include <HTTPClient.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include "DHT.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// --- Konfigurasi WiFi ---
const char* ssid = "faiz";
const char* password = "arshaka18";
// --- Konfigurasi ThingSpeak ---
String apiKey = ".";  //write API
const char* serverTS = "http://api.thingspeak.com/update";
// --- Konfigurasi Sensor ---
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);
#define SOIL_PIN 34  // ADC input soil sensor
// --- Relay Pin ---
#define RELAY_PUMP 12
#define RELAY_FAN 13
// --- Web Server ---
AsyncWebServer server(80);
// Variabel sensor
float temperature, humidity;
int soilPercent;

// ================= Timing non-blocking =================
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_INTERVAL = 2000;  // baca sensor + update LCD tiap 2 detik
unsigned long lastThingSpeak = 0;
const unsigned long THINGSPEAK_INTERVAL = 20000;  // kirim ThingSpeak tiap 20 detik (limit API)

// ================= LCD I2C =================
LiquidCrystal_I2C lcd(0x27, 20, 4);

void updateLCD() {
  lcd.setCursor(7, 1);
  lcd.print("      ");
  lcd.setCursor(7, 1);
  lcd.print(temperature, 1);
  lcd.print((char)223);
  lcd.print("C");

  lcd.setCursor(9, 2);
  lcd.print("      ");
  lcd.setCursor(9, 2);
  lcd.print(humidity, 1);
  lcd.print("%");

  lcd.setCursor(9, 3);
  lcd.print("      ");
  lcd.setCursor(9, 3);
  lcd.print(soilPercent);
  lcd.print("%");
}

void sendThingSpeak() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = serverTS;
  url += "?api_key=" + apiKey;
  url += "&field1=" + String(temperature);
  url += "&field2=" + String(humidity);
  url += "&field3=" + String(soilPercent);
  http.begin(url);
  int httpCode = http.GET();
  if (httpCode > 0) {
    Serial.println("ThingSpeak update OK");
  } else {
    Serial.println("Gagal kirim ke ThingSpeak");
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  dht.begin();

  lcd.begin();
  lcd.backlight();

  lcd.setCursor(5, 0);
  lcd.print("Monitoring");

  lcd.setCursor(0, 1);
  lcd.print("Suhu : ");

  lcd.setCursor(0, 2);
  lcd.print("K.Udara: ");

  lcd.setCursor(0, 3);
  lcd.print("K.Tanah: ");

  if (!LittleFS.begin()) {
    Serial.println("LittleFS mount gagal!");
    return;
  }
  Serial.println("LittleFS mounted.");

  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan WiFi...");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000) {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi terhubung!");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi gagal konek, lanjut tanpa WiFi (retry di loop).");
  }

  pinMode(RELAY_PUMP, OUTPUT);
  pinMode(RELAY_FAN, OUTPUT);
  digitalWrite(RELAY_PUMP, LOW);
  digitalWrite(RELAY_FAN, LOW);

  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  server.on("/data", HTTP_GET, [](AsyncWebServerRequest* request) {
    String json = "{";
    json += "\"temperature\":" + String(temperature, 1) + ",";
    json += "\"humidity\":" + String(humidity, 1) + ",";
    json += "\"soil\":" + String(soilPercent);
    json += "}";
    request->send(200, "application/json", json);
  });

  server.on("/pump", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasParam("state")) {
      String state = request->getParam("state")->value();
      digitalWrite(RELAY_PUMP, state == "1" ? HIGH : LOW);
      request->send(200, "text/plain", state == "1" ? "Pump ON" : "Pump OFF");
    } else {
      request->send(400, "text/plain", "Bad Request");
    }
  });

  server.on("/fan", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasParam("state")) {
      String state = request->getParam("state")->value();
      digitalWrite(RELAY_FAN, state == "1" ? HIGH : LOW);
      request->send(200, "text/plain", state == "1" ? "Fan ON" : "Fan OFF");
    } else {
      request->send(400, "text/plain", "Bad Request");
    }
  });

  server.begin();
}

void loop() {
  unsigned long now = millis();

  // Baca sensor + update LCD tiap SENSOR_INTERVAL, gak blok server
  if (now - lastSensorRead >= SENSOR_INTERVAL) {
    lastSensorRead = now;
    // humidity = dht.readHumidity();
    // temperature = dht.readTemperature();
    // int soilRaw = analogRead(SOIL_PIN); //range data analog 12 bit 0-4095
    // soilPercent = map(soilRaw, 4095, 1500, 0, 100);
    humidity = 23;
    temperature = 32;
    // int soilRaw = 2400;
    soilPercent = 80;

    if (isnan(humidity) || isnan(temperature)) {
      Serial.println("Gagal baca DHT22!");
    } else {
      updateLCD();
    }
  }

  // Kirim ThingSpeak tiap THINGSPEAK_INTERVAL, non-blocking juga
  if (now - lastThingSpeak >= THINGSPEAK_INTERVAL) {
    lastThingSpeak = now;
    sendThingSpeak();
  }

  // Tanpa delay() panjang → AsyncWebServer selalu responsif tiap request
}
