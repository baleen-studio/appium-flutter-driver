# !/bin/sh

echo "refreshing dependencies"

rm npm-shrinkwrap.json
APPIUM_SKIP_CHROMEDRIVER_INSTALL=1 npm run clean-dependency

npm install  --omit=dev #--production
npm prune --omit=dev --omit=peer
rm -rf node_modules/appium
npm shrinkwrap --omit=dev --omit=peer

# to install types again
#npm install --only=prod --no-package-lock
npm install --omit=dev --no-package-lock

echo "complete the refreshment"
