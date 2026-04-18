import os
import subprocess
import sys

def run_crawler():
    print(">>> 正在运行爬虫抓取最新情报...")
    crawler_path = os.path.join("scripts", "fetch_data.py")
    if not os.path.exists(crawler_path):
        print(f"Error: 找不到爬虫脚本 {crawler_path}")
        return False

    try:
        # 直接让子进程输出到当前终端
        process = subprocess.Popen(
            [sys.executable, crawler_path],
            stdout=None,
            stderr=None
        )
        process.wait()

        if process.returncode == 0:
            print("\n✅ Done: 爬虫运行成功，数据已更新。")
            return True
        else:
            print(f"\n❌ Error: 爬虫运行失败，退出码: {process.returncode}")
            return False
    except Exception as e:
        print(f"\n⚠️ Exception: {e}")
        return False

if __name__ == "__main__":
    print("=== InfoSou 数据抓取助手 ===\n")
    run_crawler()
