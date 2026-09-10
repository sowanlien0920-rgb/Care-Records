@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 訪問介護 サービス実施記録 － ローカルサーバー

echo ============================================================
echo  訪問介護 サービス実施記録  ローカルサーバー
echo ============================================================
echo.
echo  音声入力（マイク）を使う場合は、この方法で起動してください。
echo  ファイルを直接ダブルクリックして開くと、ブラウザの制限で
echo  マイクが使えないことがあります。
echo.
echo  【ご注意】
echo  ファイルを直接開いた場合と、このサーバー経由で開いた場合とで、
echo  ブラウザはデータを別々に保存します。
echo  これまでのデータを引き継ぐときは、直接開いたほうの画面で
echo  「バックアップ」→「バックアップファイルを保存」を実行し、
echo  こちらの画面で「バックアップから復元」を行ってください。
echo.
echo  終了するときは、この黒い画面で Ctrl + C を押すか
echo  ウィンドウを閉じてください。
echo ============================================================
echo.

where python >nul 2>nul
if errorlevel 1 goto NOPY

start "" http://localhost:8765/index.html
python -m http.server 8765
goto END

:NOPY
echo  Python が見つかりませんでした。
echo.
echo  次のいずれかをお試しください。
echo   1) https://www.python.org/downloads/ から Python を入れる
echo      （インストール時に「Add python.exe to PATH」に必ずチェック）
echo   2) Python を入れずに使う場合は、index.html を直接開いてください
echo      （音声入力以外の機能はすべて使えます）
echo.
pause

:END
