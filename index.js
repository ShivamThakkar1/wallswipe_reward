const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = '@WallSwipe';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Validate critical environment variables
if (!BOT_TOKEN) {
    console.error('ERROR: BOT_TOKEN is not set!');
    process.exit(1);
}

if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI is not set!');
    process.exit(1);
}

// WEBHOOK_URL will be set after first deployment
if (!WEBHOOK_URL) {
    console.warn('⚠️ WARNING: WEBHOOK_URL is not set! Set it after getting your Render URL.');
}

// MongoDB Schemas
const userSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    username: { type: String, default: null },
    firstName: { type: String, default: null },
    lastName: { type: String, default: null },
    languageCode: { type: String, default: null },
    isBot: { type: Boolean, default: false },
    isPremium: { type: Boolean, default: false },
    firstSeen: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    totalInteractions: { type: Number, default: 1 },
    wallpapersViewed: [String]
}, { timestamps: true });

const linkClickSchema = new mongoose.Schema({
    wallpaperId: { type: String, required: true },
    userId: { type: Number, required: true },
    username: { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const LinkClick = mongoose.model('LinkClick', linkClickSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize bot with webhook
const bot = new TelegramBot(BOT_TOKEN);

// Set webhook only if WEBHOOK_URL is available
if (WEBHOOK_URL) {
    const webhookPath = `/bot${BOT_TOKEN}`;
    bot.setWebHook(`${WEBHOOK_URL}${webhookPath}`)
        .then(() => {
            console.log(`✅ Webhook set successfully: ${WEBHOOK_URL}${webhookPath}`);
        })
        .catch((error) => {
            console.error('❌ Error setting webhook:', error);
        });
} else {
    console.log('⚠️ Webhook not set. Add WEBHOOK_URL to environment variables and redeploy.');
}

// Webhook endpoint
app.post('/webhook/*', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        bot: 'WallSwipe Bot Active'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).send('🎨 WallSwipe Bot is running!');
});

// Function to save/update user data
async function saveUserData(msg, wallpaperId = null) {
    try {
        const user = msg.from;
        const userId = user.id;

        let userData = await User.findOne({ userId });

        if (userData) {
            // Update existing user
            userData.username = user.username || null;
            userData.firstName = user.first_name || null;
            userData.lastName = user.last_name || null;
            userData.languageCode = user.language_code || null;
            userData.isPremium = user.is_premium || false;
            userData.lastActive = new Date();
            userData.totalInteractions += 1;
            
            if (wallpaperId && !userData.wallpapersViewed.includes(wallpaperId)) {
                userData.wallpapersViewed.push(wallpaperId);
            }
            
            await userData.save();
            console.log(`📝 Updated user: ${userId}`);
        } else {
            // Create new user
            userData = new User({
                userId,
                username: user.username || null,
                firstName: user.first_name || null,
                lastName: user.last_name || null,
                languageCode: user.language_code || null,
                isBot: user.is_bot || false,
                isPremium: user.is_premium || false,
                wallpapersViewed: wallpaperId ? [wallpaperId] : []
            });
            
            await userData.save();
            console.log(`✨ New user saved: ${userId}`);
        }

        return userData;
    } catch (error) {
        console.error('❌ Error saving user data:', error);
    }
}

// Function to track link clicks
async function trackLinkClick(userId, username, wallpaperId) {
    try {
        const linkClick = new LinkClick({
            wallpaperId,
            userId,
            username: username || null
        });
        
        await linkClick.save();
        console.log(`🔗 Link click tracked: ${wallpaperId} by ${userId}`);
    } catch (error) {
        console.error('❌ Error tracking link click:', error);
    }
}

// Handle /start command
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const startParam = match[1].trim();
    
    console.log(`📨 /start command received from ${chatId}, param: ${startParam}`);
    
    // Extract wallpaper ID from start parameter
    let wallpaperId = null;
    if (startParam) {
        wallpaperId = startParam;
    }
    
    // Save user data
    await saveUserData(msg, wallpaperId);
    
    // Track link click if wallpaper ID exists
    if (wallpaperId) {
        await trackLinkClick(msg.from.id, msg.from.username, wallpaperId);
    }
    
    // Welcome message
    let welcomeText = 
        '🎨 Welcome to WallSwipe! 🎨\n\n' +
        'Discover amazing wallpapers for your device.\n' +
        'Join our channel to get daily wallpaper updates!';
    
    // Create inline keyboard
    const keyboard = {
        inline_keyboard: []
    };
    
    // Join channel button (always present)
    keyboard.inline_keyboard.push([
        {
            text: '📢 Join WallSwipe Channel',
            url: 'https://t.me/WallSwipe'
        }
    ]);
    
    // If wallpaper ID is provided, add the specific wallpaper link
    if (wallpaperId) {
        keyboard.inline_keyboard.push([
            {
                text: '🖼️ View Wallpaper',
                url: `https://t.me/WallSwipe/${wallpaperId}`
            }
        ]);
        welcomeText += '\n\n✨ Check out this amazing wallpaper!';
    }
    
    // Send message with inline keyboard
    try {
        await bot.sendMessage(chatId, welcomeText, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        console.log(`✅ Welcome message sent to ${chatId}`);
    } catch (error) {
        console.error('❌ Error sending message:', error);
    }
});

// Admin command: /stats - Get overall statistics
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Check if user is admin
    if (ADMIN_USER_ID && userId.toString() !== ADMIN_USER_ID) {
        await bot.sendMessage(chatId, '❌ Unauthorized. Admin only command.');
        return;
    }

    try {
        const totalUsers = await User.countDocuments();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const newUsersToday = await User.countDocuments({
            firstSeen: { $gte: today }
        });

        const last7Days = new Date();
        last7Days.setDate(last7Days.getDate() - 7);
        const newUsersWeek = await User.countDocuments({
            firstSeen: { $gte: last7Days }
        });

        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);
        const newUsersMonth = await User.countDocuments({
            firstSeen: { $gte: last30Days }
        });

        const premiumUsers = await User.countDocuments({ isPremium: true });
        const totalClicks = await LinkClick.countDocuments();

        const statsMessage = `
📊 <b>Bot Statistics</b>

👥 <b>Total Users:</b> ${totalUsers}
✨ <b>New Today:</b> ${newUsersToday}
📅 <b>New This Week:</b> ${newUsersWeek}
📆 <b>New This Month:</b> ${newUsersMonth}
💎 <b>Premium Users:</b> ${premiumUsers}
🔗 <b>Total Link Clicks:</b> ${totalClicks}

Last updated: ${new Date().toLocaleString()}
        `;

        await bot.sendMessage(chatId, statsMessage, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        await bot.sendMessage(chatId, '❌ Error fetching statistics.');
    }
});

// Admin command: /toplinks - Get most clicked wallpaper links
bot.onText(/\/toplinks(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const limit = parseInt(match[1]) || 10;

    // Check if user is admin
    if (ADMIN_USER_ID && userId.toString() !== ADMIN_USER_ID) {
        await bot.sendMessage(chatId, '❌ Unauthorized. Admin only command.');
        return;
    }

    try {
        const topLinks = await LinkClick.aggregate([
            { $group: { _id: '$wallpaperId', clicks: { $sum: 1 } } },
            { $sort: { clicks: -1 } },
            { $limit: limit }
        ]);

        if (topLinks.length === 0) {
            await bot.sendMessage(chatId, '📊 No link clicks recorded yet.');
            return;
        }

        let message = `🔥 <b>Top ${limit} Performing Links</b>\n\n`;
        
        topLinks.forEach((link, index) => {
            message += `${index + 1}. Wallpaper ID: <code>${link._id}</code>\n`;
            message += `   📊 Clicks: ${link.clicks}\n`;
            message += `   🔗 https://t.me/WallSwipe/${link._id}\n\n`;
        });

        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('❌ Error fetching top links:', error);
        await bot.sendMessage(chatId, '❌ Error fetching top links.');
    }
});

// Admin command: /recentusers - Get recent users
bot.onText(/\/recentusers(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const limit = parseInt(match[1]) || 10;

    // Check if user is admin
    if (ADMIN_USER_ID && userId.toString() !== ADMIN_USER_ID) {
        await bot.sendMessage(chatId, '❌ Unauthorized. Admin only command.');
        return;
    }

    try {
        const recentUsers = await User.find()
            .sort({ firstSeen: -1 })
            .limit(limit);

        if (recentUsers.length === 0) {
            await bot.sendMessage(chatId, '📊 No users found.');
            return;
        }

        let message = `👥 <b>Recent ${limit} Users</b>\n\n`;
        
        recentUsers.forEach((user, index) => {
            const username = user.username ? `@${user.username}` : 'No username';
            const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'No name';
            const premium = user.isPremium ? '💎' : '';
            
            message += `${index + 1}. ${name} ${premium}\n`;
            message += `   👤 ${username}\n`;
            message += `   🆔 <code>${user.userId}</code>\n`;
            message += `   📅 Joined: ${user.firstSeen.toLocaleDateString()}\n`;
            message += `   🔢 Interactions: ${user.totalInteractions}\n\n`;
        });

        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('❌ Error fetching recent users:', error);
        await bot.sendMessage(chatId, '❌ Error fetching recent users.');
    }
});

// Admin command: /userinfo - Get specific user info
bot.onText(/\/userinfo(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const query = match[1];

    // Check if user is admin
    if (ADMIN_USER_ID && userId.toString() !== ADMIN_USER_ID) {
        await bot.sendMessage(chatId, '❌ Unauthorized. Admin only command.');
        return;
    }

    if (!query) {
        await bot.sendMessage(chatId, 'Usage: /userinfo <user_id or @username>');
        return;
    }

    try {
        let user;
        
        if (query.startsWith('@')) {
            // Search by username
            const username = query.substring(1);
            user = await User.findOne({ username });
        } else {
            // Search by user ID
            const userIdNum = parseInt(query);
            if (isNaN(userIdNum)) {
                await bot.sendMessage(chatId, '❌ Invalid user ID.');
                return;
            }
            user = await User.findOne({ userId: userIdNum });
        }

        if (!user) {
            await bot.sendMessage(chatId, '❌ User not found.');
            return;
        }

        const username = user.username ? `@${user.username}` : 'No username';
        const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'No name';
        const premium = user.isPremium ? '💎 Yes' : 'No';
        
        const clickCount = await LinkClick.countDocuments({ userId: user.userId });

        let message = `👤 <b>User Information</b>\n\n`;
        message += `<b>Name:</b> ${name}\n`;
        message += `<b>Username:</b> ${username}\n`;
        message += `<b>User ID:</b> <code>${user.userId}</code>\n`;
        message += `<b>Premium:</b> ${premium}\n`;
        message += `<b>Language:</b> ${user.languageCode || 'Unknown'}\n`;
        message += `<b>First Seen:</b> ${user.firstSeen.toLocaleString()}\n`;
        message += `<b>Last Active:</b> ${user.lastActive.toLocaleString()}\n`;
        message += `<b>Total Interactions:</b> ${user.totalInteractions}\n`;
        message += `<b>Link Clicks:</b> ${clickCount}\n`;
        message += `<b>Wallpapers Viewed:</b> ${user.wallpapersViewed.length}\n`;

        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('❌ Error fetching user info:', error);
        await bot.sendMessage(chatId, '❌ Error fetching user information.');
    }
});

// Admin command: /broadcast - Send message to all users
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const message = match[1];

    // Check if user is admin
    if (ADMIN_USER_ID && userId.toString() !== ADMIN_USER_ID) {
        await bot.sendMessage(chatId, '❌ Unauthorized. Admin only command.');
        return;
    }

    try {
        const users = await User.find({}, 'userId');
        let successCount = 0;
        let failCount = 0;

        await bot.sendMessage(chatId, `📢 Starting broadcast to ${users.length} users...`);

        for (const user of users) {
            try {
                await bot.sendMessage(user.userId, message, { parse_mode: 'HTML' });
                successCount++;
                // Add delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                failCount++;
                console.error(`Failed to send to ${user.userId}:`, error.message);
            }
        }

        await bot.sendMessage(chatId, 
            `✅ Broadcast complete!\n\n` +
            `✔️ Sent: ${successCount}\n` +
            `❌ Failed: ${failCount}`
        );
    } catch (error) {
        console.error('❌ Error broadcasting:', error);
        await bot.sendMessage(chatId, '❌ Error during broadcast.');
    }
});

// Admin command: /help - Show all admin commands
bot.onText(/\/adminhelp/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Check if user is admin
    if (ADMIN_USER_ID && userId.toString() !== ADMIN_USER_ID) {
        return;
    }

    const helpMessage = `
🔧 <b>Admin Commands</b>

📊 <b>/stats</b> - Get overall bot statistics
🔥 <b>/toplinks [limit]</b> - Top performing wallpaper links (default: 10)
👥 <b>/recentusers [limit]</b> - Recent users list (default: 10)
🔍 <b>/userinfo &lt;user_id/@username&gt;</b> - Get specific user details
📢 <b>/broadcast &lt;message&gt;</b> - Send message to all users
❓ <b>/adminhelp</b> - Show this help message

Examples:
• /toplinks 20
• /recentusers 15
• /userinfo @username
• /userinfo 123456789
• /broadcast Hello everyone! 🎨
    `;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error);
});

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🤖 Bot: ${BOT_TOKEN.substring(0, 10)}...`);
    if (WEBHOOK_URL) {
        console.log(`🌐 Webhook URL: ${WEBHOOK_URL}/webhook/*`);
    } else {
        console.log(`⚠️ Webhook URL not set - add WEBHOOK_URL env variable`);
    }
    console.log(`📢 Channel: ${CHANNEL_USERNAME}`);
    console.log(`👤 Admin ID: ${ADMIN_USER_ID || 'Not set'}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    bot.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    bot.close();
    process.exit(0);
});
