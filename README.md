# AnkaBot

Discord üzerinde zindan/trial kaydı, kalıcı oyuncu ekipman profili ve otomatik raid planı oluşturan bot.

## Bu sürümde neler var?

- Süresi geçen raid kartı kırmızıya döner; tüm kayıt düğmeleri kapanır.
- Hazır içeriklerin yanında özel zindan/trial adı ve türü girilebilir.
- Zindan ana kadrosu 5, trial ana kadrosu 10 kişidir. Kapasite dolunca yeni kayıt otomatik yedeğe alınır.
- Ana kadrodan biri ayrıldığında raid liderine aynı rol için yedek önerilir. Beş dakika cevap verilmezse önerilen oyuncu otomatik geçirilir.
- Kullanıcının eser, binek gücü, yoldaş ve aura envanteri Discord kullanıcı kimliği + klas adına göre `raid_profiles.json` içinde saklanır.
- Kayıtlı profil, aynı klas bir sonraki seçildiğinde otomatik yüklenir. Kullanıcı isterse **Profilimi Güncelle** düğmesini kullanabilir.
- Raid başlamadan 30 dakika önce lidere büyük PNG taslağı ve varsa eksik atama uyarıları gönderilir.
- Lider taslağı onaylayabilir, otomatik yenileyebilir veya oyuncu/alan bazında manuel değiştirebilir.
- Başlamadan 15 dakika önce 2560 px genişliğindeki final PNG kanalda paylaşılır ve ana kadrodaki herkes etiketlenir.
- Kadro eksikse tablo yine 5/10 satırla hazırlanır; eksik oyuncu ve eşya hücreleri boş kalır.
- Eski sürümde oluşturulan `raid_bas_*`, `raid_klas_secim_*` ve `raid_cikis` bileşenleriyle uyumluluk korunur.

`Yoldaş mor güçleri` ve `grup bonusları` bu sürüme bilerek dahil edilmemiştir.

## Kurulum

Node.js 20 veya daha yeni bir sürüm kullanın.

```bash
npm ci
cp config.example.json config.json
```

`config.json` içindeki değerleri kendi bot bilgilerinizle doldurun:

```json
{
  "token": "DISCORD_BOT_TOKEN",
  "clientId": "DISCORD_APPLICATION_ID",
  "logChannelId": "RAPOR_LOG_KANAL_ID"
}
```

Ardından:

```bash
npm test
npm run check
node index.js
```

Botun kanalda `Mesaj Gönder`, `Bağlantı Yerleştir`, `Dosya Ekle`, `Mesaj Geçmişini Oku` ve `Uygulama Komutlarını Kullan` izinleri olmalıdır. T−30 DM gönderimi için raid liderinin sunucu üyelerinden gelen özel mesajlara izin vermesi gerekir; DM kapalıysa uyarı raid kanalına gönderilir.

## AWS üzerinde güncelleme

Önce çalışma verilerini yedekleyin:

```bash
cd ~/AnkaBot
cp raid_data.json raid_data.backup.json 2>/dev/null || true
cp raid_profiles.json raid_profiles.backup.json 2>/dev/null || true
git pull origin main
npm ci --omit=dev
```

PM2 kullanıyorsanız:

```bash
pm2 restart AnkaBot
pm2 logs AnkaBot --lines 100
```

Bir systemd servisi kullanıyorsanız servis adını kendi kurulumunuza göre değiştirin:

```bash
sudo systemctl restart ankabot
sudo systemctl status ankabot
```

`raid_data.json` ve `raid_profiles.json` Git tarafından izlenmez. Böylece `git pull` mevcut raidleri ve oyuncu profillerini ezmez.

## Test PNG'si

Botun kullandığı gerçek çizim koduyla örnek oluşturmak için:

```bash
npm run preview
```

Çıktı proje kökünde `Anka_Raid_Plan_Ornek.png` adıyla oluşur. Trial tablosu 2560×1460 px boyutundadır ve 10 satırın tamamını içerir.

## Emoji ve görselleri değiştirme

- Discord rol/klas emoji kimlikleri `raid.js` içindeki `klasSecenekleri`, `raidEmbedOlustur` ve `raidButtonRow` bölümlerindedir.
- Eser görselleri: `assets/raid/artifacts/`
- Binek görselleri: `assets/raid/mounts/`
- Yoldaş görselleri: `assets/raid/companions/`
- Logo: `assets/raid/anka-logo.png`
- Aura ikonları kodla çizilir; renk/şekilleri `raid_table.js` içindeki `auraIcon` fonksiyonundan değiştirilebilir.

Yeni görselin dosya adını değiştirirseniz `raid_catalog.js` içindeki ilgili `icon` yolunu da güncelleyin.

## Çalışma verileri

- `raid_data.json`: Raid kadroları, yedekler, planlar ve zamanlayıcı durumu.
- `raid_profiles.json`: Kullanıcıların klas bazlı kalıcı ekipman profilleri.

Bu iki dosyanın düzenli yedeğini alın. Zamanlanmış T−30/T−15 bildirimlerinin çalışması için bot işlemi raid saatine kadar açık kalmalıdır.
