// format-chapters.js
// Format lại toàn bộ các file chương txt trong một thư mục cho sạch đẹp, dễ đọc

const fs = require('fs');
const path = require('path');
const glob = require('glob');

function formatChapterContent(content) {
    // Chuẩn hóa: xóa ký tự lạ, chỉ 1 dòng trống giữa các đoạn, xóa khoảng trắng đầu/cuối dòng
    return content
        .replace(/\r/g, '') // Xóa \r
        .split('\n')
        .map(line => line.trim())
        .filter((line, idx, arr) => {
            // Loại bỏ nhiều dòng trống liên tiếp
            if (line === '' && arr[idx - 1] === '') return false;
            return true;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n') // Không để quá 2 dòng trống liên tiếp
        .trim();
}

function formatAllChapters(folderPath) {
    const files = glob.sync('chuong*.txt', { cwd: folderPath })
        .map(f => path.join(folderPath, f));
    if (files.length === 0) {
        console.log('Không tìm thấy file chương nào trong thư mục:', folderPath);
        return;
    }
    console.log(`Đang format ${files.length} chương...`);
    files.forEach((file, idx) => {
        let content = fs.readFileSync(file, 'utf8');
        let newContent = formatChapterContent(content);
        fs.writeFileSync(file, newContent, 'utf8');
        if ((idx + 1) % 50 === 0 || idx === files.length - 1) {
            console.log(`Đã format ${idx + 1}/${files.length} chương.`);
        }
    });
    console.log('Hoàn tất format các chương!');
}

// Chạy từ dòng lệnh
if (require.main === module) {
    const folder = process.argv[2];
    if (!folder) {
        console.log('Cách dùng: node format-chapters.js <thư-mục-chứa-các-chương>');
        process.exit(1);
    }
    formatAllChapters(folder);
}
