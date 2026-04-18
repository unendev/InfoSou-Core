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
        # 直接让子进程输出到当前终端，不再截获，这样不会有编码转换报错
        # 并且用户可以实时看到抓取进度
        process = subprocess.Popen(
            [sys.executable, crawler_path],
            stdout=None,
            stderr=None
        )
        process.wait()

        if process.returncode == 0:
            print("\nDone: 爬虫运行成功，数据已更新。")
            return True
        else:
            print(f"\nError: 爬虫运行失败，退出码: {process.returncode}")
            return False
    except Exception as e:
        print(f"\nException: {e}")
        return False

def start_server(port=8080):
    print(f">>> [Step 2/2] 正在启动预览服务器...")

    # 记录当前目录以便恢复
    original_cwd = os.getcwd()
    try:
        os.chdir("public")
        Handler = http.server.SimpleHTTPRequestHandler
        socketserver.TCPServer.allow_reuse_address = True

        with socketserver.TCPServer(("", port), Handler) as httpd:
            print(f"\nSuccess! 服务已启动! 请访问: http://localhost:{port}")
            print("Tip: 修改代码后刷新页面即可，按 Ctrl+C 停止服务。")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 已停止本地调试。")
    finally:
        os.chdir(original_cwd)

if __name__ == "__main__":
    print("=== InfoSou 本地调试助手 ===\n")
    if run_crawler():
        start_server()
    else:
        print("\n⚠️  爬虫未完全成功，是否启动预览服务器查看当前数据？(y/n)")
        choice = input().lower()
        if choice == 'y':
            start_server()
