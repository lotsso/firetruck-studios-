<?php
session_start();

/*
 * Kod jest przechowywany tylko po stronie serwera.
 * Nie umieszczaj go w HTML/JavaScript.
 */
$ACCESS_CODE = '200192';

$maxAttempts = 5;
$lockoutSeconds = 300; // 5 minut

// Jeżeli użytkownik jest już odblokowany
if (isset($_SESSION['authenticated']) && $_SESSION['authenticated'] === true) {
    $texts = [
        "Witaj. Dostęp został przyznany.",
        "Losowy tekst: dzisiaj jest dobry dzień na napisanie czegoś ciekawego.",
        "Losowy tekst: system działa poprawnie.",
        "Losowy tekst: PHP właśnie obsłużyło Twoją sesję.",
        "Losowy tekst: ten komunikat został wybrany losowo."
    ];

    $randomText = $texts[array_rand($texts)];
} else {
    $randomText = null;
}

// Obsługa formularza
if ($_SERVER['REQUEST_METHOD'] === 'POST' && !isset($_SESSION['authenticated'])) {

    // Inicjalizacja licznika
    if (!isset($_SESSION['attempts'])) {
        $_SESSION['attempts'] = 0;
    }

    // Sprawdzenie blokady
    if (isset($_SESSION['locked_until']) && time() < $_SESSION['locked_until']) {
        $remaining = $_SESSION['locked_until'] - time();
        $error = "Za dużo prób. Spróbuj ponownie za $remaining sekund.";
    } else {

        // Reset blokady
        unset($_SESSION['locked_until']);

        $code = $_POST['code'] ?? '';

        if (hash_equals($ACCESS_CODE, $code)) {

            // Poprawny kod
            $_SESSION['authenticated'] = true;

            // Usuwamy informacje o próbach
            unset($_SESSION['attempts']);
            unset($_SESSION['locked_until']);

            // Nowe ID sesji
            session_regenerate_id(true);

            header('Location: index.php');
            exit;

        } else {

            $_SESSION['attempts']++;

            if ($_SESSION['attempts'] >= $maxAttempts) {
                $_SESSION['locked_until'] = time() + $lockoutSeconds;
                $_SESSION['attempts'] = 0;

                $error = "Za dużo błędnych prób. Dostęp zablokowany na 5 minut.";
            } else {
                $left = $maxAttempts - $_SESSION['attempts'];
                $error = "Nieprawidłowy kod. Pozostało prób: $left.";
            }
        }
    }
}

// Wylogowanie
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: index.php');
    exit;
}
?>

<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Panel dostępu</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #0b0b0f;
            color: white;
            font-family: Arial, sans-serif;
        }

        .box {
            width: min(90%, 420px);
            padding: 35px;
            background: #15151c;
            border: 1px solid #292936;
            border-radius: 18px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,.4);
        }

        h1 {
            margin-top: 0;
        }

        input {
            width: 100%;
            padding: 14px;
            margin: 15px 0;
            border: 1px solid #333342;
            border-radius: 10px;
            background: #0e0e13;
            color: white;
            font-size: 16px;
            text-align: center;
            outline: none;
        }

        button {
            width: 100%;
            padding: 14px;
            border: 0;
            border-radius: 10px;
            background: #5865f2;
            color: white;
            font-size: 16px;
            cursor: pointer;
        }

        button:hover {
            background: #4752c4;
        }

        .error {
            color: #ff6b6b;
            margin-top: 15px;
        }

        .success {
            color: #6bff9b;
        }

        a {
            display: inline-block;
            margin-top: 20px;
            color: #aaa;
            text-decoration: none;
        }
    </style>
</head>

<body>

<div class="box">

<?php if (!isset($_SESSION['authenticated'])): ?>

    <h1>🔒 Dostęp chroniony</h1>

    <p>Podaj kod dostępu.</p>

    <form method="POST">
        <input
            type="password"
            name="code"
            inputmode="numeric"
            autocomplete="off"
            placeholder="Kod dostępu"
            maxlength="6"
            required
        >

        <button type="submit">
            Odblokuj
        </button>
    </form>

    <?php if (isset($error)): ?>
        <div class="error">
            <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

<?php else: ?>

    <h1 class="success">✓ Odblokowano</h1>

    <p>
        <?= htmlspecialchars($randomText, ENT_QUOTES, 'UTF-8') ?>
    </p>

    <a href="?logout=1">Wyloguj</a>

<?php endif; ?>

</div>

</body>
</html>