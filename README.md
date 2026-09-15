# AnkaBot

Discord üzerinde zindan/trial kaydı, kalıcı oyuncu ekipman profili ve otomatik raid planı oluşturan bot.

## Bu sürümde neler var?

- Süresi geçen raid kartı kırmızıya döner; tüm kayıt düğmeleri kapanır.
- Discord'dan silinen raid kartı zamanlayıcıdan ve `raid_data.json` kaydından otomatik kaldırılır; daha sonra tablo paylaşılmaz.
- `/raid-oyuncu-ekle` otomatik tamamlaması yalnızca açık raidleri gösterir ve en yeni raidleri listenin başına alır.
- Hazır içeriklerin yanında özel zindan/trial adı ve türü girilebilir.
- Zindan ana kadrosu 5, trial ana kadrosu 10 kişidir. Kapasite dolunca yeni kayıt otomatik yedeğe alınır.
- Ana kadrodan biri ayrıldığında raid liderine aynı rol için yedek önerilir. Beş dakika cevap verilmezse önerilen oyuncu otomatik geçirilir.
- Kullanıcının eser, binek gücü, yoldaş ve aura envanteri Discord kullanıcı kimliği + klas adına göre `raid_profiles.json` içinde saklanır.
- Eser, binek ve yoldaş PNG'leri ilk açılışta botun uygulama emojileriyle eşleştirilir; seçim menülerinde isimlerin yanında gerçek ikonları görünür.
- Binek menüsü role göre filtrelenir: DPS yalnızca Demonic Gravehound, Tunnel Vision, Giant Toad ve Bigby's Crushing Hand; tank/healer yalnızca takım debuff bineklerini görür.
- Profil sihirbazında dinamik adım sayacı, seçili adet bilgisi, **Geri**, **İptal** ve son **Kaydet ve Katıl** onayı bulunur. Eser seçeneklerinde açıklama/tooltip gösterilmez.
- Kayıtlı profil, aynı klas bir sonraki seçildiğinde otomatik yüklenir. Kullanıcı isterse **Profilimi Güncelle** düğmesini kullanabilir.
- Raid başlamadan 30 dakika önce lidere büyük PNG taslağı ve varsa eksik atama uyarıları gönderilir.
- Lider taslağı onaylayabilir, otomatik yenileyebilir veya oyuncu/alan bazında manuel değiştirebilir.
- Başlamadan 15 dakika önce 2560 px genişliğindeki ilk plan PNG'si kanalda bir kez paylaşılır ve ana kadrodaki herkes etiketlenir.
- T−15 ile T−5 arasındaki giriş, çıkış ve rol değişiklikleri sessizce biriktirilir; plan değişmişse T−5'te yalnızca bir güncel tablo paylaşılır.
- T−5'ten sonra oluşan değişiklikler yeni mesaj üretmez; plan değişmişse etkinlik başladığı anda tek bir **Nihai raid planı** paylaşılır.
- PNG oluşturucu kendi DejaVu Sans fontunu paket içinden yükler; AWS makinesine ayrıca font kurmak gerekmez.
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

Botun kanalda `Mesaj Gönder`, `Bağlantı Yerleştir`, `Dosya Ekle`, `Mesaj Geçmişini Oku` ve `Uygulama Komutlarını Kullan` izinleri olmalıdır. T−30 DM gönderimi için raid liderinin sunucu üyelerinden gelen özel mesajlara izin vermesi gerekir; DM kapalıysa uyarı raid kanalına gönderilir. Eşya ikonları sunucu emojisi değil uygulama emojisi olduğu için sunucuda emoji yönetme izni gerekmez.

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

- Rol/klas özel emoji adları ve kimlikleri `raid.js` içindeki `klasSecenekleri`, `raidEmbedOlustur` ve `raidButtonRow` bölümlerindedir.
- Eser görselleri: `assets/raid/artifacts/`
- Binek görselleri: `assets/raid/mounts/`
- Yoldaş görselleri: `assets/raid/companions/`
- Logo: `assets/raid/anka-logo.png`
- Aura ikonları kodla çizilir; renk/şekilleri `raid_table.js` içindeki `auraIcon` fonksiyonundan değiştirilebilir.

Yeni görselin dosya adını değiştirirseniz `raid_catalog.js` içindeki ilgili `icon` yolunu da güncelleyin. Bir eşya ikonunu değiştirdiğinizde mevcut uygulama emojisini Discord Developer Portal'dan bir kez silip botu yeniden başlatırsanız yeni PNG otomatik yüklenir.

## Çalışma verileri

- `raid_data.json`: Raid kadroları, yedekler, planlar ve zamanlayıcı durumu.
- `raid_profiles.json`: Kullanıcıların klas bazlı kalıcı ekipman profilleri.

Bu iki dosyanın düzenli yedeğini alın. Zamanlanmış T−30/T−15/T−5/başlangıç bildirimlerinin çalışması için bot işlemi raid saatine kadar açık kalmalıdır.

## Türkçe / English yerelleştirme

AnkaBot son bilinen Discord dillerini `user_language_preferences.json` içinde saklar. Etkileşim dili şu sırayla belirlenir:

1. Kullanıcının güncel Discord etkileşim dili (`tr` / `tr-TR` Türkçe, diğer bütün diller İngilizce)
2. Discord dili bulunamazsa son bilinen Discord dili
3. Hiç dil bilgisi yoksa İngilizce

Raid ve duyuru dil menülerindeki Türkçe ve İngilizce seçenekleri yalnızca seçilen sürümü kullanıcıya özel olarak gösterir; gelecekteki paylaşımların dilini kalıcı olarak değiştirmez. **Automatic (Discord language)** güncel Discord dilindeki sürümü gösterir.

Paylaşılan kanal mesajları kullanıcı başına farklı gösterilemediği için yeni raid ve duyurular ilk olarak onları oluşturan kullanıcının güncel Discord dilinde gösterilir. Dil menüsünden yapılan seçim, raid kartının veya duyuru metninin seçilen dildeki tam sürümünü yalnızca o kullanıcıya ephemeral/özel yanıt olarak gösterir. Bu Discord API'sinin paylaşılan mesajlar için olan bir sınırlamasıdır. Paylaşılan duyurunun altındaki dil yönlendirmesi ve dil seçici her zaman İngilizcedir.

`config.json` için önerilen ek ayarlar:

```json
{
  "defaultLanguage": "en",
  "guildLanguages": {
    "SUNUCU_ID": "en"
  }
}
```

`guildLanguages` isteğe bağlıdır. `defaultLanguage` verilmezse İngilizce kullanılır. Bu ayarlar yalnızca Discord dil bilgisi bulunmayan eski kayıtlar için yedektir.

## Raid duyurusu

Yönetim yetkisine sahip bir görevli `/announcement` komutunu kullanır. Türkçe Discord istemcilerinde komut adı `/duyuru` olarak görünür. Komuttaki isteğe bağlı `raid` alanı en yeni açık raidleri otomatik tamamlamayla listeler.

Akış:

1. Türkçe metni yazın. `{{raid_name}}`, `{{raid_date}}`, `{{raid_time}}` ve `{{raid_relative}}` yer tutucularını kullanabilirsiniz.
2. Raid seçin; iki dilin tamamını ephemeral önizlemede kontrol edin.
3. Gerekirse Türkçe veya İngilizce metni düzenleyin ve isteğe bağlı standart satırları ekleyin.
4. `@here`, `@everyone` veya bildirimsiz yayını seçin.
5. **Yayınla** düğmesinden sonra gelen son onayı verin.

Önizlemeler toplu bildirim göndermez. Yayınlanan duyuru embed yerine doğrudan düz Discord mesajı olarak paylaşılır. Yayın sırasında toplu bildirim seçilmişse hem görevlinin hem de botun `Mention Everyone` izni doğrulanır. Normal kullanıcılar duyuru oluşturamaz fakat yayınlanan duyurunun dil menüsünü kullanarak tam Türkçe veya İngilizce metni özel yanıt olarak görebilir.

### Ücretsiz / yerel çeviri

Bu sürüm hiçbir ücretli çeviri veya OpenAI API'sine bağlanmaz. Bir OpenAI anahtarı ortamda bulunsa bile AnkaBot onu okumaz ve API ücreti oluşturamaz.

Tam otomatik çeviri istenirse yalnızca aynı makinede çalışan, Ollama uyumlu bir servis kullanılabilir. Güvenlik ve maliyet garantisi için çeviri URL'si yalnızca `localhost`, `127.0.0.1` veya `::1` olabilir:

```bash
ANKABOT_LOCAL_TRANSLATION_URL=http://127.0.0.1:11434
ANKABOT_LOCAL_TRANSLATION_MODEL=KURULU_YEREL_MODEL
ANKABOT_TRANSLATION_TIMEOUT_MS=30000
```

Yerel model yapılandırılmamışsa Türkçe taslak kaybolmaz; arayüz durumu bildirir ve görevli İngilizce metni elle girer. Hazır akıllı öneriler her iki dilde yerleşik olduğundan model gerektirmez.

## Eski raid kartlarını güncelleme

Önce yalnızca yapılacak işlemleri görmek için:

```bash
npm run migrate-localization -- --dry-run
```

Sonuçları kontrol ettikten sonra:

```bash
npm run migrate-localization
```

Betik yalnızca açık raid kayıtlarını ele alır; kanal ve mesaj kimliklerini Discord'da doğrular; yalnızca mevcut bot hesabının yazdığı mesajları düzenler. Kapanmış, silinmiş, bulunamayan veya başka bir kullanıcı/bot tarafından yazılmış mesajları güvenle atlar ve nedenini loglar. Raid, profil veya yoklama verisini silmez.

Yeni komutlar bot başlatılırken mevcut global komut kayıt sistemiyle otomatik yüklenir. Global Discord komutlarının istemcilerde görünmesi biraz zaman alabilir.

## Yeni çalışma verileri

- `user_language_preferences.json`: Kullanıcıların son bilinen Discord dili
- `announcements.json`: Taslak ve yayınlanmış duyuruların Türkçe/İngilizce metinleri ile raid/mesaj bağlantıları

Bu dosyalar Git tarafından izlenmez ve ilk kullanımda güvenli şekilde oluşturulur. Şema dönüşümü veya ayrı bir veritabanı kurulumu gerekmez.
