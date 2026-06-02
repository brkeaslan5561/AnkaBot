@off
echo Ashes of Anka Yonetim Botu Baslatiliyor...
cd C:\Users\berke\Desktop\AnkaBot
pm2 start index.js --name "AnkaBot" || pm2 restart AnkaBot
echo Bot basariyla tünelden cikti! Klasör kapanabilir.
pause