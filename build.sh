#!/bin/bash
set -e
set -o pipefail
APP=~/workspace/catatanku-app
PROJECT=$APP/project
BUILD=$APP/build
TOOLS=~/workspace/grabvideo-app/tools
BT=$TOOLS/bt/android-14
PLAT=$TOOLS/plat/android-34/android.jar
LIBS=~/workspace/grabvideo-app/libs
export JAVA_HOME=~/workspace/grabvideo-app/tools/jdk-17.0.11+9
export PATH=$JAVA_HOME/bin:$PATH

rm -rf $BUILD
mkdir -p $BUILD/gen $BUILD/classes $BUILD/dex

echo "=== aapt2 compile ==="
$BT/aapt2 compile --dir $PROJECT/app/src/main/res -o $BUILD/compiled_res.zip

echo "=== aapt2 link ==="
$BT/aapt2 link -o $BUILD/base.apk \
  --manifest $PROJECT/app/src/main/AndroidManifest.xml \
  --java $BUILD/gen \
  -I $PLAT \
  -A $PROJECT/app/src/main/assets \
  --min-sdk-version 26 --target-sdk-version 34 \
  --version-code 49 --version-name 1.11.0 \
  $BUILD/compiled_res.zip

echo "=== kotlinc ==="
find $PROJECT/app/src/main/java -name "*.kt" > $BUILD/sources.txt
find $BUILD/gen -name "*.java" >> $BUILD/sources.txt
CP="$PLAT:$LIBS/kotlin-stdlib.jar"
$TOOLS/kotlinc/bin/kotlinc -cp "$CP" -d $BUILD/classes @$BUILD/sources.txt 2>&1 | head -20

echo "=== d8 ==="
$BT/d8 --lib $PLAT \
  --output $BUILD/dex \
  $(find $BUILD/classes -name "*.class") \
  $LIBS/kotlin-stdlib.jar 2>&1 | head -20

echo "=== package APK ==="
cp $BUILD/base.apk $BUILD/app-unsigned.apk
cd $BUILD/dex && zip -q -r $BUILD/app-unsigned.apk classes.dex && cd $APP

echo "=== zipalign ==="
$BT/zipalign -f 4 $BUILD/app-unsigned.apk $BUILD/app-aligned.apk

echo "=== apksigner ==="
$BT/apksigner sign --ks ~/workspace/grabvideo-app/debug.keystore --ks-pass pass:android \
  --out $BUILD/CatatanKu-v1.11.0.apk $BUILD/app-aligned.apk

echo "=== verify ==="
$BT/apksigner verify --print-certs $BUILD/CatatanKu-v1.11.0.apk | head -5
$BT/aapt2 dump badging $BUILD/CatatanKu-v1.11.0.apk | head -6

ls -lh $BUILD/CatatanKu-v1.11.0.apk
