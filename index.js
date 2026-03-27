require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf'); 
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// === MIDDLEWARE (Пам'ять бота) ===
bot.use(session());
bot.use((ctx, next) => {
    ctx.session = ctx.session || {};
    ctx.session.chatHistory = ctx.session.chatHistory || [];
    return next();
});

// === МЕНЮ ===
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🏋️ Мої Тренування (Спліти)', 'start_workout')],
    [Markup.button.callback('🤖 Запитати Тренера (ШІ)', 'mode_coach')],
    [Markup.button.callback('🍏 Запитати Нутриціолога (ШІ)', 'mode_nutrition')],
    [Markup.button.callback('⚙️ Мій профіль', 'my_profile')]
]);

const profileMenu = Markup.inlineKeyboard([
    [Markup.button.callback('⚖️ Змінити вагу', 'edit_weight'), Markup.button.callback('📅 Змінити вік', 'edit_age')],
    [Markup.button.callback('🔙 Назад у меню', 'back_to_main')]
]);

// === СТАРТ ТА РЕЄСТРАЦІЯ ===
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || 'Спортсмен';

    try {
        const { data: existingUser } = await supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();

        if (existingUser && existingUser.weight && existingUser.age) {
            ctx.session.step = 'registered';
            return ctx.reply(`З поверненням, ${existingUser.name}! Готові працювати? 💪`, mainMenu);
        }

        if (!existingUser) {
            await supabase.from('users').insert([{ telegram_id: telegramId, name: firstName }]);
        }

        ctx.session.step = 'waiting_for_weight';
        ctx.reply(`Привіт, ${firstName}! Твій профіль створено. 🎉\n\nДавай завершимо реєстрацію. Яка твоя поточна вага (в кг)?`);
    } catch (error) {
        console.error('Помилка БД:', error);
        ctx.reply('Ой, виникла помилка при підключенні до бази даних. 😔');
    }
});

bot.command('menu', (ctx) => {
    ctx.session.step = 'registered';
    ctx.session.chatHistory = []; // Очищаємо пам'ять ШІ
    ctx.reply('Головне меню:', mainMenu);
});

// === ОБРОБНИКИ КНОПОК ПРОФІЛЮ ТА ШІ ===
bot.action('mode_coach', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'chatting_coach';
    ctx.reply('🏋️ **Тренер на зв\'язку!**\nПитання по техніці, мотивація чи поради? Пиши!', { parse_mode: 'Markdown' });
});

bot.action('mode_nutrition', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'chatting_nutritionist';
    ctx.reply('🍏 **Нутриціолог тут!**\nЩо сьогодні їли? Порахуємо калорії?', { parse_mode: 'Markdown' });
});

bot.action('my_profile', async (ctx) => {
    ctx.answerCbQuery();
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', ctx.from.id).maybeSingle();
    if (user) {
        ctx.reply(`⚙️ **Твій профіль:**\n👤 Ім'я: ${user.name}\n📅 Вік: ${user.age}\n⚖️ Вага: ${user.weight} кг`, profileMenu);
    }
});

bot.action('edit_weight', (ctx) => { ctx.answerCbQuery(); ctx.session.step = 'editing_weight'; ctx.reply('Введи нову вагу (кг):'); });
bot.action('edit_age', (ctx) => { ctx.answerCbQuery(); ctx.session.step = 'editing_age'; ctx.reply('Введи новий вік:'); });
bot.action('back_to_main', (ctx) => { ctx.answerCbQuery(); ctx.session.step = 'registered'; ctx.reply('Меню:', mainMenu); });

// === НОВА ЛОГІКА: ТРЕНУВАННЯ ТА СПЛІТИ ===

bot.action('start_workout', async (ctx) => {
    ctx.answerCbQuery();
    const telegramId = ctx.from.id;

    // Шукаємо спліти користувача
    const { data: splits } = await supabase.from('workout_splits').select('*').eq('telegram_id', telegramId);

    if (!splits || splits.length === 0) {
        // Якщо сплітів немає, пропонуємо створити
        const noSplitsMenu = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Створити свій спліт', 'create_custom_split')],
            [Markup.button.callback('📚 Стандартний (Push/Pull/Legs)', 'create_standard_split')],
            [Markup.button.callback('🔙 Назад', 'back_to_main')]
        ]);
        return ctx.reply('У тебе ще немає програм тренувань. Що оберемо?', noSplitsMenu);
    } else {
        // Якщо є, виводимо їх кнопками
        const splitButtons = splits.map(split => [Markup.button.callback(`💪 ${split.name}`, `view_split_${split.id}`)]);
        splitButtons.push([Markup.button.callback('➕ Додати новий спліт', 'create_custom_split')]);
        splitButtons.push([Markup.button.callback('🔙 Назад у меню', 'back_to_main')]);
        
        return ctx.reply('Обери своє тренування на сьогодні:', Markup.inlineKeyboard(splitButtons));
    }
});

// Створення стандартного спліту
bot.action('create_standard_split', async (ctx) => {
    ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    
    // Додаємо 3 базові дні
    await supabase.from('workout_splits').insert([
        { telegram_id: telegramId, name: 'День 1: Push (Груди/Трицепс/Плечі)' },
        { telegram_id: telegramId, name: 'День 2: Pull (Спина/Біцепс)' },
        { telegram_id: telegramId, name: 'День 3: Legs (Ноги/Прес)' }
    ]);
    
    ctx.reply('✅ Стандартний спліт успішно додано! Натисни /menu та зайди в Тренування.');
});

// Запит на створення кастомного спліту
bot.action('create_custom_split', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'waiting_for_split_name';
    ctx.reply('Введи назву для свого нового дня тренувань (наприклад: "Вівторок - Тільки руки"):');
});

// Перегляд конкретного спліту (Regex для відлову динамічного ID)
bot.action(/view_split_(.+)/, async (ctx) => {
    ctx.answerCbQuery();
    const splitId = ctx.match[1];
    
    const { data: split } = await supabase.from('workout_splits').select('*').eq('id', splitId).single();
    const { data: exercises } = await supabase.from('workout_exercises').select('*').eq('split_id', splitId);

    let text = `🔥 **Тренування: ${split.name}**\n\n`;
    
    if (!exercises || exercises.length === 0) {
        text += 'Тут ще немає вправ. Давай додамо!';
    } else {
        exercises.forEach((ex, index) => {
            text += `${index + 1}. ${ex.name} — ${ex.sets} підх. по ${ex.reps_target} повт.\n`;
        });
    }

    const splitMenu = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Додати вправу', `add_ex_${splitId}`)],
        [Markup.button.callback('🔙 Назад до списку', 'start_workout')]
    ]);

    ctx.reply(text, splitMenu);
});

// Кнопка додавання вправи
bot.action(/add_ex_(.+)/, (ctx) => {
    ctx.answerCbQuery();
    ctx.session.activeSplitId = ctx.match[1]; // Зберігаємо ID спліту, куди додаємо
    ctx.session.step = 'waiting_for_exercise';
    ctx.reply('Напиши вправу у форматі: **Назва, Підходи, Повторення**\n\n*(Наприклад: Жим лежачи, 4, 10)*', { parse_mode: 'Markdown' });
});


// === ОБРОБНИК ТЕКСТУ (Центр управління) ===
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramId = ctx.from.id;

    // Логування всіх повідомлень
    try { await supabase.from('messages').insert([{ telegram_id: telegramId, message_text: text }]); } catch (e) {}

    // 1. РЕЄСТРАЦІЯ ТА ПРОФІЛЬ
    if (ctx.session.step === 'waiting_for_weight' || ctx.session.step === 'editing_weight') {
        const weight = parseFloat(text);
        if (isNaN(weight)) return ctx.reply('Введи число.');
        await supabase.from('users').update({ weight: weight }).eq('telegram_id', telegramId);
        if (ctx.session.step === 'waiting_for_weight') {
            ctx.session.step = 'waiting_for_age';
            return ctx.reply('Супер! Тепер напиши свій вік:');
        }
        ctx.session.step = 'registered';
        return ctx.reply('✅ Вагу оновлено!', mainMenu);
    }

    if (ctx.session.step === 'waiting_for_age' || ctx.session.step === 'editing_age') {
        const age = parseInt(text);
        if (isNaN(age)) return ctx.reply('Введи число.');
        await supabase.from('users').update({ age: age }).eq('telegram_id', telegramId);
        ctx.session.step = 'registered';
        return ctx.reply('✅ Вік збережено!', mainMenu);
    }

    // 2. СТВОРЕННЯ СПЛІТІВ ТА ВПРАВ
    if (ctx.session.step === 'waiting_for_split_name') {
        await supabase.from('workout_splits').insert([{ telegram_id: telegramId, name: text }]);
        ctx.session.step = 'registered';
        return ctx.reply(`✅ Спліт "${text}" створено! Натисни /menu щоб його побачити.`);
    }

    if (ctx.session.step === 'waiting_for_exercise') {
        // Простий парсинг тексту користувача
        const parts = text.split(',');
        if (parts.length < 3) return ctx.reply('Будь ласка, використовуй формат: Назва, Підходи, Повторення (через кому).');
        
        const exName = parts[0].trim();
        const exSets = parseInt(parts[1].trim()) || 3;
        const exReps = parts[2].trim();

        await supabase.from('workout_exercises').insert([{ 
            split_id: ctx.session.activeSplitId, 
            name: exName, 
            sets: exSets, 
            reps_target: exReps 
        }]);

        ctx.session.step = 'registered';
        return ctx.reply(`✅ Вправу "${exName}" додано! Тисни /menu`);
    }

    // 3. ЛОГІКА ШІ (З ПАМ'ЯТТЮ)
    if (ctx.session.step === 'chatting_coach' || ctx.session.step === 'chatting_nutritionist') {
        try {
            ctx.sendChatAction('typing'); 
            const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();
            
            let roleDescription = ctx.session.step === 'chatting_coach' 
                ? 'Ти досвідчений фітнес-тренер.' 
                : 'Ти професійний нутриціолог. Твоя ціль - аналізувати їжу та рахувати калорії.';

            const systemPrompt = `${roleDescription} Твій клієнт: ${user?.name || 'Спортсмен'}, вік ${user?.age}, вага ${user?.weight} кг. Відповідай українською коротко.`;

            const apiMessages = [
                { role: 'system', content: systemPrompt },
                ...ctx.session.chatHistory,
                { role: 'user', content: text }
            ];

            const chatCompletion = await groq.chat.completions.create({
                messages: apiMessages,
                model: 'llama-3.3-70b-versatile', 
            });

            const response = chatCompletion.choices[0].message.content;

            ctx.session.chatHistory.push({ role: 'user', content: text });
            ctx.session.chatHistory.push({ role: 'assistant', content: response });
            if (ctx.session.chatHistory.length > 8) ctx.session.chatHistory = ctx.session.chatHistory.slice(-8);

            return ctx.reply(response + '\n\n(Меню: /menu)');
        } catch (error) {
            console.error('Помилка Groq:', error);
            return ctx.reply('Ой, щось пішло не так з ШІ. Спробуй ще раз!');
        }
    }

    ctx.reply('Я тебе не зовсім зрозумів. Використовуй меню: /menu');
});

// === ДЛЯ ХОСТИНГУ ТА WEBHOOK ===
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const secretPath = `/telegraf/${bot.secretPathComponent()}`;

app.get('/', (req, res) => res.send('Бот-тренер працює онлайн! 🍏'));

const webhookDomain = process.env.WEBHOOK_DOMAIN;
if (webhookDomain) {
    bot.telegram.setWebhook(`${webhookDomain}${secretPath}`);
    app.use(bot.webhookCallback(secretPath));
    console.log(`✅ Webhook налаштовано: ${webhookDomain}`);
} else {
    bot.launch();
    console.log('✅ Бот запущений (Polling)!');
}

app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));