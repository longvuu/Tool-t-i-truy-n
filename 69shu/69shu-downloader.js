const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function downloadBook(input, concurrentDownloads = 5) {
    let browser;
    try {
        // Khởi tạo Puppeteer
        console.log('Khởi tạo trình duyệt Puppeteer...');
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        console.log('Đã khởi tạo trình duyệt thành công!');
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Thêm xử lý lỗi
        page.on('error', err => {
            console.error('Lỗi trang web:', err);
        });
        
        page.on('pageerror', err => {
            console.error('Lỗi Javascript:', err);
        });
        
        let bookDetail;
        if (input.startsWith('http')) {
            // Nếu input là URL, lấy chi tiết truyện trực tiếp
            console.log(`Đang truy cập URL truyện: ${input}`);
            bookDetail = await getBookDetail(input, page);
        } else {
            // Nếu input là từ khóa, thực hiện tìm kiếm
            console.log(`Đang tìm kiếm truyện với từ khóa: ${input}`);
            const searchResults = await search69shu(input, page);
            if (searchResults.length === 0) {
                console.error('Không tìm thấy truyện nào với từ khóa:', input);
                return;
            }
            console.log(`Đã tìm thấy ${searchResults.length} kết quả, chọn kết quả đầu tiên: ${searchResults[0].title}`);
            bookDetail = await getBookDetail(searchResults[0].url, page);
        }

        console.log(`=== Thông tin truyện ===`);
        console.log(`Tiêu đề: ${bookDetail.title}`);
        console.log(`Tác giả: ${bookDetail.author}`);
        console.log(`Nguồn: ${bookDetail.source}`);
        console.log(`======================`);

        // Tạo thư mục lưu truyện
        const outputDir = path.join(__dirname, 'downloaded_books');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const bookDir = path.join(outputDir, sanitizeFilename(bookDetail.title));
        if (!fs.existsSync(bookDir)) {
            fs.mkdirSync(bookDir, { recursive: true });
        }

        // Lấy danh sách chương
        console.log('Đang lấy danh sách chương...');
        const toc = await getToc(bookDetail.source, page);
        console.log(`Đã tìm thấy ${toc.length} chương.`);

        if (toc.length === 0) {
            console.error('Không tìm thấy chương nào! Không thể tiếp tục.');
            return;
        }

        // Lưu thông tin truyện
        const bookInfoPath = path.join(bookDir, 'info.json');
        fs.writeFileSync(bookInfoPath, JSON.stringify({
            title: bookDetail.title,
            author: bookDetail.author,
            description: bookDetail.description,
            cover: bookDetail.cover,
            source: bookDetail.source,
            totalChapters: toc.length,
            downloadDate: new Date().toISOString()
        }, null, 2), 'utf8');
        console.log(`Đã lưu thông tin truyện vào ${bookInfoPath}`);

        // Tạo file tổng hợp tất cả chương
        const fullBookPath = path.join(bookDir, `${sanitizeFilename(bookDetail.title)}.txt`);
        fs.writeFileSync(fullBookPath, `${bookDetail.title}\nTác giả: ${bookDetail.author}\n\n${bookDetail.description || ''}\n\n`, 'utf8');

        // Tải từng chương
        console.log(`\n=== BẮT ĐẦU TẢI TRUYỆN (${toc.length} chương) ===\n`);
        const failedChapters = [];
        const chapterChunks = chunkArray(toc, concurrentDownloads);
        
        for (let chunkIndex = 0; chunkIndex < chapterChunks.length; chunkIndex++) {
            const chapterChunk = chapterChunks[chunkIndex];
            console.log(`\nĐang tải nhóm ${chunkIndex + 1}/${chapterChunks.length} (${chapterChunk.length} chương)`);

            const chapterPromises = chapterChunk.map(async (chapter, indexInChunk) => {
                const globalIndex = chunkIndex * concurrentDownloads + indexInChunk;
                const chapterNumber = globalIndex + 1;
                
                console.log(`[${chapterNumber}/${toc.length}] Đang tải: ${chapter.name}`);

                let retries = 3;
                let chapterContent;
                
                while (retries > 0) {
                    try {
                        // Tạo page mới cho mỗi chương để tránh vấn đề với state
                        const chapterPage = await browser.newPage();
                        await chapterPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                        
                        chapterContent = await getChapter(chapter.url, chapterPage);
                        
                        // Đóng page sau khi sử dụng
                        await chapterPage.close();
                        
                        // Kiểm tra nội dung có hợp lệ không
                        if (!chapterContent.content || chapterContent.content.length < 50) {
                            throw new Error('Nội dung chương quá ngắn hoặc rỗng');
                        }
                        
                        break; // Thành công, thoát khỏi loop retry
                    } catch (error) {
                        retries--;
                        console.log(`[${chapterNumber}/${toc.length}] Lỗi, còn ${retries} lần thử: ${error.message}`);
                        if (retries > 0) {
                            await new Promise(resolve => setTimeout(resolve, 2000)); // Đợi 2 giây trước khi thử lại
                        } else {
                            console.error(`[${chapterNumber}/${toc.length}] Không thể tải: ${chapter.name}`);
                            failedChapters.push({
                                index: globalIndex,
                                name: chapter.name,
                                url: chapter.url
                            });
                            chapterContent = {
                                title: chapter.name,
                                content: `[Lỗi] Không thể tải nội dung chương. URL: ${chapter.url}`
                            };
                        }
                    }
                }

                // Chuẩn bị văn bản
                const chapterText = `${chapterContent.title}\n\n${chapterContent.content}\n\n`;
                
                // Lưu chương riêng
                const chapterFileName = `chuong${String(chapterNumber).padStart(4, '0')}.txt`;
                const chapterPath = path.join(bookDir, chapterFileName);
                fs.writeFileSync(chapterPath, chapterText, 'utf8');
                
                // Thêm vào file tổng hợp
                fs.appendFileSync(fullBookPath, `${chapterContent.title}\n\n${chapterContent.content}\n\n${'='.repeat(50)}\n\n`, 'utf8');
                
                console.log(`[${chapterNumber}/${toc.length}] ✓ Đã lưu: ${chapter.name}`);

                return {
                    name: chapter.name,
                    content: chapterContent.content
                };
            });

            await Promise.all(chapterPromises);

            if (chunkIndex < chapterChunks.length - 1) {
                console.log('Đợi một chút trước khi tải nhóm tiếp theo...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Lưu thông tin các chương bị lỗi (nếu có)
        if (failedChapters.length > 0) {
            const failedPath = path.join(bookDir, 'failed_chapters.json');
            fs.writeFileSync(failedPath, JSON.stringify(failedChapters, null, 2), 'utf8');
            console.log(`\n⚠️ Có ${failedChapters.length} chương bị lỗi. Danh sách đã được lưu vào ${failedPath}`);
        }

        console.log(`\n✅ HOÀN TẤT TẢI TRUYỆN: ${bookDetail.title}`);
        console.log(`Đã tải ${toc.length - failedChapters.length}/${toc.length} chương`);
        console.log(`Truyện được lưu tại: ${bookDir}`);
        console.log(`File tổng hợp: ${fullBookPath}`);
    } catch (error) {
        console.error('\n❌ LỖI KHI TẢI TRUYỆN:', error);
    } finally {
        if (browser) {
            console.log('Đang đóng trình duyệt...');
            await browser.close();
            console.log('Đã đóng trình duyệt.');
        }
    }
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
}

function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

async function search69shu(keyword, page) {
    const searchUrl = `https://www.69shuba.com/search.php?keyword=${encodeURIComponent(keyword)}`;
    console.log(`Đang tìm kiếm: ${searchUrl}`);
    
    try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Đợi để trang load đầy đủ
        
        // Chụp ảnh màn hình để debug
        await page.screenshot({ path: `debug-search-${Date.now()}.png` });
        
        const results = await page.evaluate(() => {
            // Debug các selector
            console.log('Debug search selectors:');
            console.log('- .result-list .result-item:', document.querySelectorAll('.result-list .result-item').length);
            console.log('- .result-item:', document.querySelectorAll('.result-item').length);
            console.log('- .novelslist2 li:', document.querySelectorAll('.novelslist2 li').length);
            console.log('- .book-list li:', document.querySelectorAll('.book-list li').length);
            
            // Thử nhiều selector khác nhau cho kết quả tìm kiếm
            let items = Array.from(document.querySelectorAll('.result-list .result-item'));
            if (items.length === 0) {
                items = Array.from(document.querySelectorAll('.result-item'));
            }
            if (items.length === 0) {
                items = Array.from(document.querySelectorAll('.novelslist2 li'));
            }
            if (items.length === 0) {
                items = Array.from(document.querySelectorAll('.book-list li'));
            }
            
            console.log(`Tìm thấy ${items.length} kết quả tìm kiếm`);
            
            return items.map(item => {
                // Lấy tiêu đề và URL
                const titleElement = item.querySelector('a[href*="book"]') || 
                                    item.querySelector('a[href*="/txt/"]') ||
                                    item.querySelector('a');
                const title = titleElement ? titleElement.innerText.trim() : 'Không có tiêu đề';
                const url = titleElement ? titleElement.href : '';
                
                // Lấy tác giả
                const authorElement = item.querySelector('.author') || 
                                     item.querySelector('.book-info .writer') ||
                                     item.querySelector('.book_author');
                const author = authorElement ? authorElement.innerText.trim().replace('作者：', '') : 'Không rõ tác giả';
                
                if (!url || !title) return null;
                
                return { title, url, author };
            }).filter(item => item !== null);
        });
        
        console.log(`Tìm thấy ${results.length} kết quả hợp lệ`);
        
        // Nếu không tìm thấy kết quả, thử với domain khác
        if (results.length === 0) {
            const alternativeUrl = searchUrl.replace('www.69shuba.com', '69shu.com');
            console.log(`Không tìm thấy kết quả, thử với domain khác: ${alternativeUrl}`);
            
            await page.goto(alternativeUrl, { waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const alternativeResults = await page.evaluate(() => {
                // Thử lại với các selector
                const items = Array.from(document.querySelectorAll('.result-item') || 
                                       document.querySelectorAll('.book-list li') || 
                                       document.querySelectorAll('.search-list li') || []);
                
                return items.map(item => {
                    const titleElement = item.querySelector('a');
                    const title = titleElement ? titleElement.innerText.trim() : 'Không có tiêu đề';
                    const url = titleElement ? titleElement.href : '';
                    
                    const authorElement = item.querySelector('.author') || 
                                         item.querySelector('.writer');
                    const author = authorElement ? authorElement.innerText.trim() : 'Không rõ tác giả';
                    
                    if (!url || !title) return null;
                    
                    return { title, url, author };
                }).filter(item => item !== null);
            });
            
            console.log(`Tìm thấy ${alternativeResults.length} kết quả hợp lệ từ domain thay thế`);
            return alternativeResults;
        }
        
        return results;
    } catch (error) {
        console.error(`Lỗi khi tìm kiếm: ${error.message}`);
        return [];
    }
}

// Hàm helper để đợi với timeout tùy chỉnh
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBookDetail(bookUrl, page) {
    console.log(`Đang lấy thông tin truyện từ: ${bookUrl}`);
    await page.goto(bookUrl, { waitUntil: 'networkidle2' });
    // Thay waitForTimeout bằng Promise setTimeout
    await new Promise(resolve => setTimeout(resolve, 1000)); 
    
    const detail = await page.evaluate(() => {
        // Debug selectors
        console.log('Debug book detail selectors:');
        console.log('- h1:', !!document.querySelector('h1'));
        console.log('- meta[name="author"]:', !!document.querySelector('meta[name="author"]'));
        console.log('- .author a:', !!document.querySelector('.author a'));
        console.log('- #bookimg img:', !!document.querySelector('#bookimg img'));
        console.log('- #intro:', !!document.querySelector('#intro'));
        
        // Lấy tiêu đề
        const titleElement = document.querySelector('h1') || 
                            document.querySelector('h2.book_info_title') || 
                            document.querySelector('.book-info h1');
        const title = titleElement ? titleElement.innerText.trim() : 'Không rõ tiêu đề';
        
        // Lấy tác giả
        const authorMeta = document.querySelector('meta[name="author"]');
        const authorLink = document.querySelector('.author a') || 
                          document.querySelector('.book-info .writer') ||
                          document.querySelector('.info .writer');
                          
        const author = authorMeta ? authorMeta.getAttribute('content') : 
                     (authorLink ? authorLink.innerText.trim().replace('作者：', '') : 'Không rõ tác giả');
        
        // Lấy hình ảnh bìa
        const cover = document.querySelector('#bookimg img') ||
                     document.querySelector('.book-img img') ||
                     document.querySelector('.cover img');
        const coverUrl = cover ? cover.src : '';
        
        // Lấy mô tả
        const description = document.querySelector('#intro') ||
                           document.querySelector('.book-info .intro') ||
                           document.querySelector('.info .intro');
        const desc = description ? description.innerText.trim() : '';
        
        // Lấy thể loại
        const genreElement = document.querySelector('.book-info .cat') ||
                            document.querySelector('.info .cat');
        const genre = genreElement ? genreElement.innerText.trim().replace('类别：', '') : '';
        
        // Lấy trạng thái
        const statusElement = document.querySelector('.book-info .status') ||
                             document.querySelector('.info .status');
        const status = statusElement ? statusElement.innerText.trim().replace('状态：', '') : '';
        
        const source = window.location.href;
        
        console.log(`Đã lấy thông tin chi tiết truyện: ${title} của ${author}`);
        
        return { 
            title, 
            author, 
            cover: coverUrl, 
            description: desc,
            genre,
            status, 
            source 
        };
    });
    
    // Kiểm tra kết quả
    if (!detail.title || detail.title === 'Không rõ tiêu đề') {
        console.log('Cảnh báo: Không thể lấy tiêu đề truyện, có thể đã bị chặn hoặc HTML có cấu trúc khác');
        await page.screenshot({ path: `debug-book-detail-${Date.now()}.png` });
    }
    
    return detail;
}

async function getToc(bookUrl, page) {
    // Chuyển từ URL chi tiết sang URL danh sách chương
    let tocUrl = bookUrl;
    if (bookUrl.endsWith('.htm')) {
        tocUrl = bookUrl.replace('.htm', '/');
    }
    
    console.log(`Đang truy cập danh sách chương: ${tocUrl}`);
    await page.goto(tocUrl, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Đợi thêm để đảm bảo nội dung đã tải xong
    
    const pageHtml = await page.content();
    console.log(`Debug HTML: Trang TOC có độ dài ${pageHtml.length} ký tự`);
    
    const chapters = await page.evaluate(() => {
        // Thử với nhiều selector khác nhau
        let chapterElements = document.querySelectorAll('.catalog ul li a');
        
        // Debug selectors
        console.log('Debug TOC selectors:');
        console.log('- .catalog ul li a:', document.querySelectorAll('.catalog ul li a').length);
        console.log('- .book_list a:', document.querySelectorAll('.book_list a').length);
        console.log('- #chapterList a:', document.querySelectorAll('#chapterList a').length);
        console.log('- .chapter-list a:', document.querySelectorAll('.chapter-list a').length);
        
        // Fallbacks
        if (!chapterElements || chapterElements.length === 0) {
            chapterElements = document.querySelectorAll('.book_list a');
        }
        if (!chapterElements || chapterElements.length === 0) {
            chapterElements = document.querySelectorAll('#chapterList a');
        }
        if (!chapterElements || chapterElements.length === 0) {
            chapterElements = document.querySelectorAll('.chapter-list a');
        }
        
        console.log(`Tìm thấy ${chapterElements.length} link chương`);
        
        // Tạo một array từ NodeList
        const chaptersArray = Array.from(chapterElements).map(item => {
            const name = item.innerText.trim();
            const url = item.href;
            
            // Lấy data-num nếu có
            let dataNum = '0';
            if (item.parentElement && item.parentElement.getAttribute('data-num')) {
                dataNum = item.parentElement.getAttribute('data-num');
            }
            // Nếu không có data-num, thử tìm trong text của chương
            else {
                const match = name.match(/第(\d+)章/);
                if (match && match[1]) {
                    dataNum = match[1];
                }
            }
            
            // Lọc bỏ các link không hợp lệ
            if (!name || !url) return null;
            
            // Bỏ qua các link không phải chương
            if (name.includes('书签') || name.includes('目录') || name.includes('最新章节')) return null;
            
            return { 
                name, 
                url,
                number: parseInt(dataNum) || 0
            };
        }).filter(item => item !== null);
        
        // Kiểm tra và sắp xếp theo số thứ tự
        if (chaptersArray.length > 0 && chaptersArray.some(chapter => chapter.number > 0)) {
            return chaptersArray.sort((a, b) => a.number - b.number);
        }
        // Nếu không có số thứ tự hợp lệ, giữ nguyên thứ tự
        return chaptersArray;
    });
    
    console.log(`Debug: Tìm thấy ${chapters.length} chương hợp lệ`);
    if (chapters.length > 0) {
        console.log(`Chương đầu tiên: ${chapters[0].name} - ${chapters[0].url}`);
        if (chapters.length > 1) {
            console.log(`Chương cuối: ${chapters[chapters.length-1].name} - ${chapters[chapters.length-1].url}`);
        }
    } else {
        console.log('Cảnh báo: Không tìm thấy chương nào! Thử chụp màn hình để debug');
        await page.screenshot({ path: `debug-toc-${Date.now()}.png` });
    }
    
    return chapters;
}

async function getChapter(chapterUrl, page) {
    console.log(`Đang tải nội dung từ: ${chapterUrl}`);
    await page.goto(chapterUrl, { waitUntil: 'networkidle2' });
    
    // Đợi để trang load đầy đủ
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const content = await page.evaluate(() => {
        // Lấy tiêu đề chương
        let titleElement = document.querySelector('h1.hide720') || document.querySelector('h1');
        const title = titleElement ? titleElement.innerText.trim() : 'Chương không có tiêu đề';
        
        // Lấy nội dung từ .txtnav (không chỉ #txtright)
        let contentElement = document.querySelector('.txtnav');
        
        if (contentElement) {
            // Loại bỏ các phần tử quảng cáo và không cần thiết
            const adsToRemove = contentElement.querySelectorAll('.bottom-ad, .contentadv, script');
            adsToRemove.forEach(ad => ad.remove());
            
            // Lấy HTML nội dung
            let htmlContent = contentElement.innerHTML;
            
            // Bỏ phần tử #txtright vì nó chỉ chứa quảng cáo
            htmlContent = htmlContent.replace(/<div id="txtright"[^>]*>.*?<\/div>/is, '');
            
            // Bỏ các phần tử không cần thiết khác
            htmlContent = htmlContent.replace(/<div class="txtinfo[^>]*>.*?<\/div>/g, '');
            htmlContent = htmlContent.replace(/<h1[^>]*>.*?<\/h1>/g, '');
            
            // Chuyển đổi HTML entities và giữ định dạng
            let text = htmlContent
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&emsp;/g, '    ')
                .replace(/&gt;/g, '>')
                .replace(/&lt;/g, '<')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .trim();
                
            // Làm sạch khoảng trắng thừa
            text = text.replace(/\n\s*\n/g, '\n\n');
            
            // Loại bỏ các dòng trống đầu và cuối
            text = text.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
            
            console.log(`Đã lấy nội dung chương: ${title} (${text.length} ký tự)`);
            
            return { title, content: text };
        } else {
            console.log('Không tìm thấy phần tử .txtnav');
            
            // Thử phương pháp thay thế
            const bodyText = document.body.innerText;
            const startPos = bodyText.indexOf(title);
            
            if (startPos > -1) {
                let endPos = bodyText.lastIndexOf('(本章完)');
                if (endPos === -1) endPos = bodyText.indexOf('下一章');
                if (endPos === -1) endPos = bodyText.length;
                
                const extractedText = bodyText.substring(startPos + title.length, endPos).trim();
                return { title, content: extractedText };
            }
            
            return { title, content: 'Không thể tải nội dung chương' };
        }
    });
    
    // Kiểm tra nội dung trích xuất
    if (!content.content || content.content.length < 100) {
        console.log('Cảnh báo: Nội dung chương quá ngắn, thử phương pháp trích xuất thay thế');
        
        // Thử phương pháp 2 - lấy toàn bộ text sau tiêu đề
        const alternativeContent = await page.evaluate(() => {
            const title = document.querySelector('h1.hide720')?.innerText.trim() || 
                         document.querySelector('h1')?.innerText.trim() || 
                         'Chương không có tiêu đề';
            
            // Lấy toàn bộ text nodes từ document
            const allText = [];
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        const parent = node.parentElement;
                        // Bỏ qua script, style, nav, header, footer
                        if (parent && (
                            parent.tagName === 'SCRIPT' || 
                            parent.tagName === 'STYLE' ||
                            parent.id === 'pageheadermenu' ||
                            parent.id === 'pagefootermenu' ||
                            parent.className.includes('tools') ||
                            parent.className.includes('bottom-ad')
                        )) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            
            let node;
            let found = false;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (text === title) {
                    found = true;
                    continue;
                }
                
                if (found && text && 
                    !text.includes('书签') && 
                    !text.includes('上一章') &&
                    !text.includes('下一章') &&
                    !text.includes('目录')) {
                    allText.push(text);
                }
                
                // Dừng khi gặp "本章完"
                if (text.includes('本章完')) {
                    break;
                }
            }
            
            return { 
                title, 
                content: allText.join('\n') 
            };
        });
        
        // Nếu phương pháp thay thế cho kết quả tốt hơn, sử dụng nó
        if (alternativeContent.content.length > content.content.length) {
            content.content = alternativeContent.content;
        }
        
        // Chụp ảnh màn hình để debug
        await page.screenshot({ path: `debug-chapter-${Date.now()}.png` });
    }
    
    return content;
}

// Ví dụ sử dụng
if (require.main === module) {
    const keyword = process.argv[2];
    const concurrentDownloads = parseInt(process.argv[3]) || 5;

    if (keyword) {
        console.log(`Bắt đầu tải với ${concurrentDownloads} lượt tải đồng thời...`);
        downloadBook(keyword, concurrentDownloads).catch(err => console.error('Lỗi khi tải truyện:', err));
    } else {
        console.log('Cách sử dụng: node 69shu-downloader.js <từ-khóa> [số-lượt-tải-đồng-thời]');
        console.log('Ví dụ: node 69shu-downloader.js "example keyword" 10');
        console.log('Mặc định số lượt tải đồng thời: 5');
    }
}