import os
import subprocess
import sys
import http.server
import socketserver
import threading
import time

def run_crawler():
    print(">>> [Step 1/2] 正在运行爬虫抓取最新情报...")
    crawler_path = os.path.join("scripts", "fetch_data.py")
    if not os.path.exists(crawler_path):
        print(f"Error: 找不到爬虫脚本 {crawler_path}")
        return False

    try:
        # 运行爬虫脚本
        result = subprocess.run([sys.executable, crawler_path], capture_output=True, text=True, encoding='utf-8')
        if result.returncode == 0:
            print("Done: 爬虫运行成功，数据已更新。")
            return True
        else:
            print("Error: 爬虫运行失败:")
            print(result.stderr)
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False

def start_server(port=8080):
    print(f">>> [Step 2/2] 正在启动预览服务器...")
    os.chdir("public")
    Handler = http.server.SimpleHTTPRequestHandler

    # 允许地址重用，防止端口被占用报错
    socketserver.TCPServer.allow_reuse_address = True

    with socketserver.TCPServer(("", port), Handler) as httpd:
        print(f"\nSuccess! 服务已启动! 请访问: http://localhost:{port}")
        print("Tip: 修改代码后刷新页面即可，按 Ctrl+C 停止服务。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 已停止本地调试。")
            sys.exit(0)

if __name__ == "__main__":
    print("=== InfoSou 本地调试助手 ===\n")
    if run_crawler():
        start_server()
    else:
        print("\n⚠️  爬虫失败，是否强行启动预览服务器预览旧数据？(y/n)")
        choice = input().lower()
        if choice == 'y':
            start_server()
