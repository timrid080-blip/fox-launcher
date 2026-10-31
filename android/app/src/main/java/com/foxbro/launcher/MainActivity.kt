package com.foxbro.launcher

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private val bg = Color.rgb(14, 14, 17)
    private val panel = Color.rgb(27, 27, 33)
    private val orange = Color.rgb(255, 122, 26)
    private val white = Color.rgb(240, 240, 245)
    private val muted = Color.rgb(165, 165, 178)
    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var root: LinearLayout
    private var page = "Главная"
    private var busy = false
    private var secureSessionStore = true

    private fun prefs() = EncryptedSharedPreferences.create(
        this, "fox-secure-session",
        MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = try { prefs() } catch (_: Exception) {
            secureSessionStore = false
            getSharedPreferences("fox-settings", MODE_PRIVATE)
        }
        showWelcome()
    }

    private fun base(title: String, subtitle: String? = null): LinearLayout {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            setBackgroundColor(bg)
        }
        val brand = TextView(this).apply {
            text = "🦊  FOX LAUNCHER   •   5.0"
            textSize = 13f; setTextColor(orange); typeface = Typeface.DEFAULT_BOLD
        }
        outer.addView(brand)
        val heading = TextView(this).apply {
            text = title; textSize = 28f; setTextColor(white)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setPadding(0, dp(18), 0, dp(4))
        }
        outer.addView(heading)
        if (!subtitle.isNullOrBlank()) outer.addView(TextView(this).apply {
            text = subtitle; textSize = 14f; setTextColor(muted); setPadding(0, 0, 0, dp(14))
        })
        return outer
    }

    private fun field(hint: String, password: Boolean = false): EditText = EditText(this).apply {
        this.hint = hint; setTextColor(white); setHintTextColor(muted); textSize = 15f
        setSingleLine(true); setPadding(dp(14), dp(10), dp(14), dp(10))
        background = shape(panel, 12)
        if (password) inputType = 129
    }

    private fun button(text: String, primary: Boolean = false, action: () -> Unit): Button = Button(this).apply {
        this.text = text; isAllCaps = false; textSize = 14f
        setTextColor(if (primary) Color.rgb(28, 15, 4) else white)
        background = shape(if (primary) orange else panel, 12)
        setPadding(dp(10), dp(6), dp(10), dp(6))
        setOnClickListener { action() }
    }

    private fun shape(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
        if (color == panel) setStroke(dp(1), Color.rgb(53, 53, 64))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun scroll(content: View): ScrollView = ScrollView(this).apply {
        addView(content, ViewGroup.LayoutParams(-1, -2))
        isFillViewport = true
        setBackgroundColor(bg)
    }
    private fun gap(parent: LinearLayout, height: Int = 10) {
        parent.addView(View(this), LinearLayout.LayoutParams(1, dp(height)))
    }
    private fun message(parent: LinearLayout, value: String, error: Boolean = false) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 13f
            setTextColor(if (error) Color.rgb(255, 110, 110) else muted)
            setPadding(0, dp(8), 0, dp(8))
        })
    }

    private fun showWelcome() {
        val box = base("Твой мир — рядом", "Minecraft, друзья и сообщество Fox в одном мобильном приложении.")
        val url = field("Supabase URL  (https://….supabase.co)")
        val key = field("Supabase publishable key")
        url.setText(prefs.getString("supabase_url", ""))
        key.setText(prefs.getString("supabase_key", ""))
        val email = field("Электронная почта")
        val nick = field("Ник  (3–16 латинских букв, цифр или _)")
        val password = field("Пароль — минимум 12 символов", true)
        box.addView(url); gap(box); box.addView(key); gap(box, 18)
        box.addView(email); gap(box); box.addView(nick); gap(box); box.addView(password); gap(box, 16)
        message(box, "Для облачного входа укажи URL и публичный ключ Supabase своего проекта. Секретный service_role key сюда вводить нельзя.")
        box.addView(button("Войти", true) {
            prefs.edit().putString("supabase_url", url.text.toString().trim().trimEnd('/'))
                .putString("supabase_key", key.text.toString().trim()).apply()
            auth(email.text.toString().trim(), password.text.toString(), null, box)
        })
        gap(box)
        box.addView(button("Создать аккаунт Fox") {
            prefs.edit().putString("supabase_url", url.text.toString().trim().trimEnd('/'))
                .putString("supabase_key", key.text.toString().trim()).apply()
            auth(email.text.toString().trim(), password.text.toString(), nick.text.toString().trim(), box)
        })
        setContentView(scroll(box))
    }

    private fun auth(email: String, password: String, nickname: String?, parent: LinearLayout) {
        if (busy) return
        if (email.isBlank() || password.length < 12 || (nickname != null && !Regex("^[A-Za-z0-9_]{3,16}$").matches(nickname))) {
            message(parent, "Проверь почту, пароль (от 12 символов) и ник.", true); return
        }
        busy = true
        message(parent, "Подключаемся к Fox ID…")
        thread {
            try {
                val base = prefs.getString("supabase_url", "")!!.trimEnd('/')
                val key = prefs.getString("supabase_key", "")!!
                require(base.startsWith("https://") && base.endsWith(".supabase.co") && key.isNotBlank()) {
                    "Проверь Supabase URL и publishable key."
                }
                val path = if (nickname == null) "/auth/v1/token?grant_type=password" else "/auth/v1/signup"
                val body = JSONObject().put("email", email).put("password", password)
                if (nickname != null) body.put("data", JSONObject().put("nickname", nickname))
                val result = request(base + path, key, null, body)
                if (result.has("access_token")) {
                    if (!secureSessionStore) throw IllegalStateException("Не удалось открыть защищённое хранилище сессии. Перезапусти приложение и попробуй снова.")
                    prefs.edit().putString("access_token", result.optString("access_token"))
                        .putString("refresh_token", result.optString("refresh_token"))
                        .putLong("expires_at", System.currentTimeMillis() + result.optLong("expires_in", 3600) * 1000).apply()
                    runOnUiThread { busy = false; showDashboard() }
                } else {
                    runOnUiThread { busy = false; showWelcomeWithNotice("Проверь почту и подтверди регистрацию, если подтверждение включено в Supabase.") }
                }
            } catch (e: Exception) {
                runOnUiThread { busy = false; showWelcomeWithNotice(e.message ?: "Не удалось подключиться.") }
            }
        }
    }

    private fun showWelcomeWithNotice(note: String) {
        showWelcome()
        Toast.makeText(this, note, Toast.LENGTH_LONG).show()
    }

    private fun request(url: String, key: String, token: String?, body: JSONObject): JSONObject {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"; conn.connectTimeout = 15000; conn.readTimeout = 20000
        conn.setRequestProperty("apikey", key)
        conn.setRequestProperty("Content-Type", "application/json")
        if (!token.isNullOrBlank()) conn.setRequestProperty("Authorization", "Bearer $token")
        conn.doOutput = true
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream.bufferedReader().use { it.readText() }
        conn.disconnect()
        val json = try { JSONObject(text) } catch (_: Exception) {
            if (text.trimStart().startsWith("[")) JSONObject().put("data", org.json.JSONArray(text))
            else JSONObject().put("message", text)
        }
        if (code !in 200..299) throw IllegalStateException(json.optString("msg", json.optString("message", "Ошибка Fox ID ($code)")))
        return json
    }

    private fun api(path: String, body: JSONObject): JSONObject {
        val base = prefs.getString("supabase_url", "")!!.trimEnd('/')
        val key = prefs.getString("supabase_key", "")!!
        var token = prefs.getString("access_token", null)
        if (token.isNullOrBlank()) throw IllegalStateException("Сначала войди в аккаунт Fox.")
        if (prefs.getLong("expires_at", 0) < System.currentTimeMillis() + 60000) {
            val refresh = prefs.getString("refresh_token", null) ?: throw IllegalStateException("Сессия истекла. Войди снова.")
            val renewed = request("$base/auth/v1/token?grant_type=refresh_token", key, null, JSONObject().put("refresh_token", refresh))
            token = renewed.optString("access_token")
            prefs.edit().putString("access_token", token).putString("refresh_token", renewed.optString("refresh_token", refresh))
                .putLong("expires_at", System.currentTimeMillis() + renewed.optLong("expires_in", 3600) * 1000).apply()
        }
        return request("$base$path", key, token, body)
    }

    private fun rpc(name: String, data: JSONObject = JSONObject()): JSONObject =
        api("/rest/v1/rpc/$name", JSONObject().put("p_op", "get").put("p_data", data))

    private fun showDashboard() {
        val outer = base("Fox ID", "Мобильный кабинет Fox Launcher 5.0")
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
            background = shape(panel, 16)
        }
        val nickname = TextView(this).apply { text = "Загружаем профиль…"; textSize = 22f; setTextColor(white); typeface = Typeface.DEFAULT_BOLD }
        val email = TextView(this).apply { textSize = 13f; setTextColor(muted) }
        val balance = TextView(this).apply { textSize = 14f; setTextColor(white) }
        card.addView(nickname); gap(card, 5); card.addView(email); gap(card, 14); card.addView(balance)
        content.addView(card); gap(content, 14)
        message(content, "Мобильная версия — кабинет аккаунта: профиль Fox ID и балансы. Запуск Minecraft, моды и игровые инструменты остаются в версии для ПК.")
        val status = TextView(this).apply { textSize = 13f; setTextColor(muted) }
        content.addView(status); gap(content, 8)
        content.addView(button("Обновить данные", true) { loadAccountSummary(nickname, email, balance, status) })
        gap(content, 8)
        content.addView(button("Выйти из аккаунта") {
            prefs.edit().remove("access_token").remove("refresh_token").remove("expires_at").apply()
            showWelcome()
        })
        outer.addView(scroll(content), LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(outer)
        loadAccountSummary(nickname, email, balance, status)
        loadProfileCheck()
    }

    private fun loadProfileCheck() {
        thread {
            try {
                val state = api("/rest/v1/rpc/fox_action", JSONObject().put("p_action", "state").put("p_data", JSONObject()))
                if (state.optBoolean("is_admin")) runOnUiThread {
                    val rootView = window.decorView.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
                    val parent = if (rootView is ScrollView) rootView.getChildAt(0) as? ViewGroup else rootView as? ViewGroup
                    parent?.let {
                        val ownerButton = button("Инструменты владельца  ›") { showOwnerTools() }
                        it.addView(ownerButton)
                    }
                }
            } catch (_: Exception) { }
        }
    }

    private fun showOwnerTools() {
        val box = base("Инструменты владельца", "Только для владельца Fox ID.")
        val title = field("Заголовок объявления")
        val body = field("Текст объявления")
        box.addView(title); gap(box); box.addView(body); gap(box)
        box.addView(button("Опубликовать объявление", true) {
            thread {
                try {
                    val state = api("/rest/v1/rpc/fox_action", JSONObject().put("p_action", "state").put("p_data", JSONObject()))
                    if (!state.optBoolean("is_admin")) throw IllegalStateException("Нет прав владельца.")
                    api("/rest/v1/rpc/fox_owner_broadcast", JSONObject().put("p_title", title.text.toString()).put("p_body", body.text.toString()))
                    runOnUiThread { Toast.makeText(this, "Объявление отправлено", Toast.LENGTH_LONG).show() }
                } catch (e: Exception) {
                    runOnUiThread { Toast.makeText(this, e.message ?: "Не удалось опубликовать", Toast.LENGTH_LONG).show() }
                }
            }
        })
        gap(box); box.addView(button("Назад") { showDashboard() })
        setContentView(scroll(box))
    }

    private fun loadAccountSummary(nickname: TextView, email: TextView, balance: TextView, status: TextView) {
        if (busy) return
        busy = true; status.text = "Обновляем данные Fox ID…"
        thread {
            try {
                val state = api("/rest/v1/rpc/fox_action", JSONObject().put("p_action", "state").put("p_data", JSONObject()))
                val profile = state.optJSONObject("profile") ?: JSONObject()
                val wallet = state.optJSONObject("wallet") ?: JSONObject()
                val nick = profile.optString("nickname", "Игрок Fox")
                val mail = profile.optString("email", "")
                val foxes = wallet.optLong("foxes", 0)
                val pumpkins = wallet.optLong("pumpkins", 0)
                val rubles = wallet.optLong("paid_kopeks", 0) / 100.0
                runOnUiThread {
                    nickname.text = nick
                    email.text = if (mail.isBlank()) "Fox ID подключён" else mail
                    balance.text = "🦊 Фоксы: $foxes    🎃 Тыквы: $pumpkins\nУчётный баланс: $rubles ₽"
                    status.text = if (state.optBoolean("is_admin")) "Статус: владелец Fox" else "Статус: аккаунт подключён"
                    busy = false
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = e.message ?: "Не удалось обновить профиль"; busy = false }
            }
        }
    }
