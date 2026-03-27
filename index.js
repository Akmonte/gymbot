require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf'); 
const { createClient } = require('@supabase/supabase-js');
// 1. Підключаємо бібліотеку Groq
const Groq = require('groq-sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// 2. Ініціалізуємо клієнт Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

bot.use(session());
// Глобальний запобіжник для пам'яті
bot.use((ctx, next) => {
    ctx.session = ctx.session || {};
    return next();
});

const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🏋️ Почати тренування', 'start_workout')],
    [Markup.button.callback('🍏 Запитати про раціон', 'ask_nutrition')],
    [Markup.button.callback('⚙️ Мій профіль', 'my_profile')]
]);

const profileMenu = Markup.inlineKeyboard([
    [Markup.button.callback('⚖️ Змінити вагу', 'edit_weight'), Markup.button.callback('📅 Змінити вік', 'edit_age')],
    [Markup.button.callback('👤 Змінити ім\'я', 'edit_name')],
    [Markup.button.callback('🔙 Назад у меню', 'back_to_main')]
]);

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || 'Спортсмен';

    try {
        const { data: existingUser } = await supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();

        if (existingUser && existingUser.weight && existingUser.age) {
            ctx.session.step = 'registered';
            return ctx.reply(`З поверненням, ${existingUser.name}! Що плануємо сьогодні? 💪`, mainMenu);
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
    ctx.reply('Головне меню:', mainMenu);
});

// === ОБРОБНИКИ КНОПОК ===

bot.action('start_workout', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('Тут ми пізніше додамо вибір днів тренувань (наприклад, Груди/Спина/Ноги).');
});

bot.action('ask_nutrition', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'chatting_with_ai';
    ctx.reply('Я готовий! Напиши мені, що ти сьогодні їв, або запитай пораду щодо раціону. 🍏\n\n(Я врахую твою вагу та вік для розрахунків).');
});

bot.action('my_profile', async (ctx) => {
    ctx.answerCbQuery();
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', ctx.from.id).maybeSingle();
        
    if (user) {
        ctx.reply(`⚙️ **Твій профіль:**\n👤 Ім'я: ${user.name}\n📅 Вік: ${user.age} років\n⚖️ Вага: ${user.weight} кг\n\nЩо бажаєш змінити?`, profileMenu);
    } else {
        ctx.reply('Не зміг знайти твої дані. Спробуй /start');
    }
});

bot.action('edit_weight', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'editing_weight';
    ctx.reply('Введи свою нову вагу (в кг):');
});

bot.action('edit_age', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'editing_age';
    ctx.reply('Введи свій новий вік:');
});

bot.action('edit_name', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'editing_name';
    ctx.reply('Введи нове ім\'я, як мені до тебе звертатися:');
});

bot.action('back_to_main', (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'registered';
    ctx.reply('Повертаємось до головного меню:', mainMenu);
});

// === ОБРОБНИК ТЕКСТУ ===

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramId = ctx.from.id;

    if (ctx.session.step === 'waiting_for_weight') {
        const weight = parseFloat(text);
        if (isNaN(weight)) return ctx.reply('Будь ласка, введи просто число.');
        await supabase.from('users').update({ weight: weight }).eq('telegram_id', telegramId);
        ctx.session.step = 'waiting_for_age';
        return ctx.reply('Супер, вагу записав! 👍\n\nТепер напиши свій вік (повних років):');
    }

    if (ctx.session.step === 'waiting_for_age') {
        const age = parseInt(text);
        if (isNaN(age)) return ctx.reply('Будь ласка, введи ціле число.');
        await supabase.from('users').update({ age: age }).eq('telegram_id', telegramId);
        ctx.session.step = 'registered';
        return ctx.reply('Готово! 🎉 Реєстрація повністю завершена.', mainMenu);
    }

    if (ctx.session.step === 'editing_weight') {
        const weight = parseFloat(text);
        if (isNaN(weight)) return ctx.reply('Будь ласка, введи число.');
        await supabase.from('users').update({ weight: weight }).eq('telegram_id', telegramId);
        ctx.session.step = 'registered';
        return ctx.reply('✅ Вагу успішно оновлено!', mainMenu);
    }

    if (ctx.session.step === 'editing_age') {
        const age = parseInt(text);
        if (isNaN(age)) return ctx.reply('Будь ласка, введи ціле число.');
        await supabase.from('users').update({ age: age }).eq('telegram_id', telegramId);
        ctx.session.step = 'registered';
        return ctx.reply('✅ Вік успішно оновлено!', mainMenu);
    }

    if (ctx.session.step === 'editing_name') {
        await supabase.from('users').update({ name: text }).eq('telegram_id', telegramId);
        ctx.session.step = 'registered';
        return ctx.reply(`✅ Супер! Тепер звертатимусь до тебе: ${text}`, mainMenu);
    }
    
    // --- 3. НОВА ЛОГІКА ШІ (через Groq) ---
    if (ctx.session.step === 'chatting_with_ai') {
        try {
            ctx.sendChatAction('typing'); 

            const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();
            
            const systemPrompt = `Ти професійний фітнес-тренер та нутриціолог. Твій клієнт: ім'я ${user?.name || 'Спортсмен'}, вік ${user?.age || 20} років, вага ${user?.weight || 70} кг. 
            Дай коротку, дружню та професійну відповідь на його повідомлення українською мовою.`;

            // Викликаємо модель Llama 3 через Groq (вона дуже швидка)
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: text }
                ],
                model: 'llama-3.3-70b-versatile', 
            });

            const response = chatCompletion.choices[0].message.content;
            return ctx.reply(response + '\n\n(Щоб повернутися до меню, натисни /menu)');
        } catch (error) {
            console.error('Помилка Groq API:', error);
            return ctx.reply('Ой, мої ШІ-мізки трохи перевантажені. Спробуй ще раз! 🤯');
        }
    }

    ctx.reply('Я тебе не зовсім зрозумів. Використовуй меню: /menu');
});

bot.launch();
console.log('✅ Бот з інтегрованим ШІ Llama 3 (Groq) запущений!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));