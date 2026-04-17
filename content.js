// 监听鼠标抬起事件
document.addEventListener('mouseup', function(event) {
    // 获取选中的文字
    let selectedText = window.getSelection().toString().trim();
    
    if (selectedText.length > 0) {
        // 简单粗暴地弹个窗确认抓到了词
        alert("你刚刚选中了术语: " + selectedText + "\n(准备发送给本地 Python API...)");
    }
});