' =============================================================================
' MACRO: Sincronizar Entregas desde Supabase
' =============================================================================
' INSTALACION:
'   1. Abrir el Excel de Control Partes Talleristas
'   2. Alt+F11 (abrir editor VBA)
'   3. En el panel izquierdo, doble click en "ThisWorkbook"
'   4. Pegar el contenido de Sub Workbook_Open y Sub SincronizarEntregas
'   5. Cerrar el editor, guardar como .xlsm (con macros)
'   6. Cada vez que se abra el archivo, se sincroniza automaticamente
'
' REQUISITOS:
'   - Hoja llamada "ENTREGAS" con columnas: A=Fecha, B=Tall, C=Cod, D=Cjas, E=ID
'   - Columna E (ID) es oculta, guarda el id de Supabase para evitar duplicados
'   - Habilitar referencia: Herramientas > Referencias > Microsoft XML, v6.0
' =============================================================================

' --- Pegar esto en ThisWorkbook ---

Private Sub Workbook_Open()
    SincronizarEntregas
End Sub

' --- Pegar esto en un Modulo nuevo (Insertar > Modulo) ---

Public Sub SincronizarEntregas()

    Const SUPABASE_URL As String = "https://hrxfctzncixxqmpfhskv.supabase.co"
    Const SUPABASE_KEY As String = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs"
    Const TABLA As String = "Entregas Tallerista Virgilio"
    Const HOJA As String = "ENTREGAS"

    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(HOJA)
    On Error GoTo 0

    If ws Is Nothing Then
        ' No hay hoja ENTREGAS, no hacer nada
        Exit Sub
    End If

    ' --- Paso 1: Recopilar IDs existentes en columna E ---
    Dim idsExistentes As Object
    Set idsExistentes = CreateObject("Scripting.Dictionary")

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row

    Dim i As Long
    For i = 2 To lastRow
        Dim idVal As String
        idVal = Trim(CStr(ws.Cells(i, 5).Value))
        If idVal <> "" And idVal <> "0" Then
            idsExistentes(idVal) = True
        End If
    Next i

    ' --- Paso 2: Fetch de Supabase (paginado, 1000 por request) ---
    Dim todosLosRegistros As Object
    Set todosLosRegistros = CreateObject("System.Collections.ArrayList")

    Dim offset As Long
    offset = 0
    Dim pageSize As Long
    pageSize = 1000

    Do
        Dim url As String
        url = SUPABASE_URL & "/rest/v1/" & WorksheetFunction.EncodeURL(TABLA) & _
              "?select=id,Fecha,Nombre_Tall,Cod,Cajas" & _
              "&order=id.asc" & _
              "&offset=" & offset & "&limit=" & pageSize

        Dim http As Object
        Set http = CreateObject("MSXML2.XMLHTTP")
        http.Open "GET", url, False
        http.setRequestHeader "apikey", SUPABASE_KEY
        http.setRequestHeader "Authorization", "Bearer " & SUPABASE_KEY
        http.setRequestHeader "Content-Type", "application/json"
        http.send

        If http.Status <> 200 Then
            MsgBox "Error conectando a Supabase: " & http.Status & " - " & http.responseText, vbExclamation
            Exit Sub
        End If

        Dim jsonText As String
        jsonText = http.responseText

        ' Parsear JSON manualmente (array de objetos)
        Dim registros As Object
        Set registros = ParseJsonArray(jsonText)

        If registros.Count = 0 Then Exit Do

        Dim reg As Variant
        For Each reg In registros
            todosLosRegistros.Add reg
        Next reg

        If registros.Count < pageSize Then Exit Do
        offset = offset + pageSize
    Loop

    ' --- Paso 3: Insertar solo los nuevos ---
    Dim nuevos As Long
    nuevos = 0
    Dim nextRow As Long
    nextRow = lastRow + 1
    If nextRow < 2 Then nextRow = 2 ' Respetar header en fila 1

    Dim item As Variant
    For Each item In todosLosRegistros
        Dim idStr As String
        idStr = CStr(item("id"))

        ' Saltar si ya existe
        If idsExistentes.Exists(idStr) Then GoTo NextItem

        ' Formatear fecha: "2026-04-15" -> "15-abr"
        Dim fechaStr As String
        fechaStr = CStr(item("Fecha"))
        Dim fechaFormateada As String
        fechaFormateada = FormatearFecha(fechaStr)

        ' Escribir en la hoja
        ws.Cells(nextRow, 1).Value = fechaFormateada    ' A = Fecha
        ws.Cells(nextRow, 2).Value = item("Nombre_Tall") ' B = Tallerista
        ws.Cells(nextRow, 3).Value = item("Cod")         ' C = Codigo
        ws.Cells(nextRow, 4).Value = CLng(item("Cajas")) ' D = Cajas (numero)
        ws.Cells(nextRow, 5).Value = CLng(item("id"))     ' E = ID (oculta)

        nuevos = nuevos + 1
        nextRow = nextRow + 1

NextItem:
    Next item

    ' Ocultar columna E (IDs internos)
    ws.Columns("E").Hidden = True

    ' Feedback sutil en la barra de estado
    If nuevos > 0 Then
        Application.StatusBar = "Entregas sincronizadas: " & nuevos & " nuevas de " & todosLosRegistros.Count & " totales"
    Else
        Application.StatusBar = "Entregas al dia (" & todosLosRegistros.Count & " registros)"
    End If

    ' Limpiar barra de estado despues de 5 segundos
    Application.OnTime Now + TimeSerial(0, 0, 5), "LimpiarStatusBar"

End Sub

Public Sub LimpiarStatusBar()
    Application.StatusBar = False
End Sub

' =============================================================================
' UTILIDADES
' =============================================================================

Private Function FormatearFecha(ByVal fechaISO As String) As String
    ' "2026-04-15" -> "15-abr"
    On Error GoTo FallbackFecha

    If Len(fechaISO) < 10 Then
        FormatearFecha = fechaISO
        Exit Function
    End If

    Dim anio As Integer, mes As Integer, dia As Integer
    anio = CInt(Left(fechaISO, 4))
    mes = CInt(Mid(fechaISO, 6, 2))
    dia = CInt(Mid(fechaISO, 9, 2))

    Dim meses(1 To 12) As String
    meses(1) = "ene": meses(2) = "feb": meses(3) = "mar": meses(4) = "abr"
    meses(5) = "may": meses(6) = "jun": meses(7) = "jul": meses(8) = "ago"
    meses(9) = "sep": meses(10) = "oct": meses(11) = "nov": meses(12) = "dic"

    FormatearFecha = dia & "-" & meses(mes)
    Exit Function

FallbackFecha:
    FormatearFecha = fechaISO
End Function

Private Function ParseJsonArray(ByVal json As String) As Object
    ' Parser simple para array de objetos JSON planos
    ' Retorna Collection de Dictionary
    Dim result As Object
    Set result = CreateObject("System.Collections.ArrayList")

    json = Trim(json)
    If Left(json, 1) <> "[" Then
        Set ParseJsonArray = result
        Exit Function
    End If

    ' Quitar [ y ]
    json = Mid(json, 2, Len(json) - 2)

    ' Separar objetos
    Dim depth As Long
    depth = 0
    Dim objStart As Long
    objStart = 0
    Dim ch As String
    Dim pos As Long

    For pos = 1 To Len(json)
        ch = Mid(json, pos, 1)
        If ch = "{" Then
            If depth = 0 Then objStart = pos
            depth = depth + 1
        ElseIf ch = "}" Then
            depth = depth - 1
            If depth = 0 And objStart > 0 Then
                Dim objStr As String
                objStr = Mid(json, objStart, pos - objStart + 1)

                Dim dict As Object
                Set dict = ParseJsonObject(objStr)
                result.Add dict

                objStart = 0
            End If
        End If
    Next pos

    Set ParseJsonArray = result
End Function

Private Function ParseJsonObject(ByVal json As String) As Object
    ' Parser simple para un objeto JSON plano (sin objetos anidados)
    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    ' Quitar { y }
    json = Mid(json, 2, Len(json) - 2)

    ' Split por comas (respetando strings)
    Dim inString As Boolean
    inString = False
    Dim pairs As Object
    Set pairs = CreateObject("System.Collections.ArrayList")
    Dim pairStart As Long
    pairStart = 1

    Dim pos As Long
    Dim ch As String
    Dim prevCh As String
    prevCh = ""

    For pos = 1 To Len(json)
        ch = Mid(json, pos, 1)
        If ch = """" And prevCh <> "\" Then
            inString = Not inString
        ElseIf ch = "," And Not inString Then
            pairs.Add Trim(Mid(json, pairStart, pos - pairStart))
            pairStart = pos + 1
        End If
        prevCh = ch
    Next pos
    ' Ultimo par
    If pairStart <= Len(json) Then
        pairs.Add Trim(Mid(json, pairStart))
    End If

    ' Parsear cada "key":value
    Dim pair As Variant
    For Each pair In pairs
        Dim colonPos As Long
        colonPos = InStr(pair, ":")
        If colonPos > 0 Then
            Dim key As String
            key = Trim(Left(pair, colonPos - 1))
            ' Quitar comillas del key
            If Left(key, 1) = """" Then key = Mid(key, 2, Len(key) - 2)

            Dim val As String
            val = Trim(Mid(pair, colonPos + 1))
            ' Quitar comillas del value si es string
            If Left(val, 1) = """" Then
                val = Mid(val, 2, Len(val) - 2)
            ElseIf val = "null" Then
                val = ""
            End If

            dict(key) = val
        End If
    Next pair

    Set ParseJsonObject = dict
End Function
