#!/bin/bash
# kaya-math を GitHub Pages にデプロイするスクリプト

set -e

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SOURCE_DIR"

echo "=== 📐 kaya-math デプロイ開始 ==="

# 変更の有無を確認
if [[ -z $(git status -s) ]]; then
  echo "ℹ️ 変更はありません。デプロイはスキップされました。"
  echo "🌐 公開URL: https://mokasz.github.io/kaya-math/"
  exit 0
fi

MSG="${1:-Update math visualizers $(date '+%Y-%m-%d %H:%M')}"

echo "📦 変更をステージング中..."
git add .

echo "📝 コミット中: $MSG"
git commit -m "$MSG"

echo "🚀 GitHubへプッシュ中..."
git push origin main

echo "⏳ GitHub Pages のビルド・デプロイ完了を待機中..."
COMMIT_SHA=$(git rev-parse HEAD)
python3 -c "
import sys, time, urllib.request, json

sha = '$COMMIT_SHA'
url = f'https://api.github.com/repos/mokasz/kaya-math/commits/{sha}/check-runs'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})

max_attempts = 30
for attempt in range(1, max_attempts + 1):
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            runs = data.get('check_runs', [])
            if not runs:
                time.sleep(5)
                continue
            
            all_completed = True
            any_failed = False
            deploy_success = False
            
            for r in runs:
                status = r.get('status')
                conclusion = r.get('conclusion')
                name = r.get('name')
                
                if status != 'completed':
                    all_completed = False
                elif conclusion in ['failure', 'cancelled', 'timed_out']:
                    any_failed = True
                    print(f'  ❌ Job \'{name}\' concluded as {conclusion}.')
                elif conclusion == 'success':
                    deploy_success = True
            
            if any_failed:
                print('❌ デプロイジョブでエラーが発生しました。')
                sys.exit(1)
            
            if all_completed and deploy_success:
                print('✅ GitHub Pages のビルド・デプロイが正常に完了しました！')
                sys.exit(0)
                
            print(f'  [{attempt}/{max_attempts}] デプロイ処理中... (10秒待機)')
            time.sleep(10)
    except Exception as e:
        time.sleep(10)

print('⚠️ タイムアウト（またはチェック未取得）ですが、プッシュは完了しています。')
" || true

echo ""
echo "🎉 デプロイ完了！"
echo "🌐 公開URL: https://mokasz.github.io/kaya-math/"
